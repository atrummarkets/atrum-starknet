/**
 * The keeper.
 *
 * WHAT IT IS FOR
 *
 * A round of bidding has to be closed, cleared and settled. Those three calls take no
 * permission from anyone, which means somebody has to make them — and until now that somebody
 * was the user, clicking through an exchange's internal machinery in their own browser.
 *
 * This does it instead. With it running, a trader places a bet and comes back to a result;
 * "close", "clear" and "settle" stop existing as far as they are concerned.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *
 * Reveal. That needs the bettor's own secret, and if a keeper could reveal an order it could
 * read an order, which would make the seal decoration. Revealing stays with whoever placed
 * the bet — the one step that is theirs by construction rather than by omission.
 *
 * WHY IT IS SAFE TO RUN, AND SAFE TO NOT RUN
 *
 * Every call is permissionless, so a second keeper run by a stranger does the same work and
 * neither interferes: whoever gets there first advances the round and the loser sees
 * WRONG_PHASE, which is success reported as an error. Nothing here can move anyone's money,
 * settle a market, or choose an outcome. If it dies, the market does not — it just waits for
 * someone to run one.
 */
import { Account, RpcProvider } from "starknet";

const RPC = process.env.KEEPER_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const FACTORY = process.env.KEEPER_FACTORY;
const ADDRESS = process.env.KEEPER_ADDRESS;
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY;

const POLL_MS = Number(process.env.KEEPER_POLL_MS ?? 30_000);
const MIN_BETS = Number(process.env.KEEPER_MIN_BETS ?? 2);

/**
 * How long to leave a round open for reveals before clearing it.
 *
 * THIS IS THE ONLY ETHICALLY LOAD-BEARING SETTING HERE.
 *
 * Whoever calls `clear` fixes the reveal cutoff, and the contract does not enforce a minimum.
 * A keeper that cleared the instant a round closed would silently exclude every bet whose
 * owner had not revealed yet — their stake returns, but their bet never happens. Done
 * deliberately and repeatedly, that is censorship with no on-chain trace.
 *
 * So: wait, generously, from the first moment the round is seen open for reveals. The cost of
 * waiting too long is a slow market. The cost of not waiting is other people's trades.
 */
const REVEAL_WINDOW_MS = Number(process.env.KEEPER_REVEAL_WINDOW_MS ?? 180_000);

const ONCE = process.argv.includes("--once");

const PHASES = ["Open", "Revealing", "Cleared", "Resolved", "Refunding"];

if (!FACTORY || !ADDRESS || !PRIVATE_KEY) {
  console.error(
    "Missing config. Needs KEEPER_FACTORY, KEEPER_ADDRESS and KEEPER_PRIVATE_KEY.\n" +
      "See keeper/README.md.",
  );
  process.exit(1);
}

const provider = new RpcProvider({ nodeUrl: RPC });
// starknet 10.x takes an options object here. The old positional form compiles and then
// hands `undefined` to the address, which fails deep inside the constructor with a
// toLowerCase error that says nothing about the real cause.
const account = new Account({ provider, address: ADDRESS, signer: PRIVATE_KEY });

/** First time each market was seen open for reveals, so the window is measured, not guessed. */
const revealingSince = new Map();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function view(contract, entrypoint, calldata = []) {
  const r = await provider.callContract({ contractAddress: contract, entrypoint, calldata });
  return r;
}

async function listMarkets() {
  const [count] = await view(FACTORY, "market_count");
  const n = Number(BigInt(count));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await view(FACTORY, "market_at", [i.toString()]);
    out.push(r[0]);
  }
  return out;
}

async function readMarket(address) {
  const [phaseRaw] = await view(address, "get_phase");
  const [batchRaw] = await view(address, "get_batch");
  const batch = Number(BigInt(batchRaw));
  const [countRaw] = await view(address, "get_order_count", [batch.toString()]);
  return {
    address,
    phase: PHASES[Number(BigInt(phaseRaw))] ?? "Open",
    batch,
    orders: Number(BigInt(countRaw)),
  };
}

/** How many of a round's orders have been revealed. Clearing early would drop the rest. */
async function revealedCount(address, batch, orders) {
  let revealed = 0;
  for (let i = 0; i < orders; i++) {
    const [commitment] = await view(address, "get_batch_commitment", [
      batch.toString(),
      i.toString(),
    ]);
    const order = await view(address, "get_order", [commitment]);
    // Order layout: escrow, batch, revealed, side, limit, units, filled, holder, settled
    if (BigInt(order[2]) === 1n) revealed++;
  }
  return revealed;
}

async function send(address, entrypoint, calldata = []) {
  const { transaction_hash } = await account.execute([
    { contractAddress: address, entrypoint, calldata },
  ]);
  return transaction_hash;
}

/** Decide the one thing this market needs, or nothing. */
async function nextAction(m) {
  if (m.phase === "Open") {
    if (m.orders < MIN_BETS) return null;
    return { entrypoint: "close_batch", calldata: [], why: `${m.orders} bets in` };
  }

  if (m.phase === "Revealing") {
    const key = `${m.address}:${m.batch}`;
    if (!revealingSince.has(key)) {
      revealingSince.set(key, Date.now());
      log(`  ${short(m.address)} reveal window opened, waiting ${REVEAL_WINDOW_MS / 1000}s`);
      return null;
    }
    const waited = Date.now() - revealingSince.get(key);
    const revealed = await revealedCount(m.address, m.batch, m.orders);

    // Clear early only when there is nothing left to wait for.
    if (revealed >= m.orders) {
      return { entrypoint: "clear", calldata: [], why: "everyone revealed" };
    }
    if (waited < REVEAL_WINDOW_MS) {
      return null;
    }
    return {
      entrypoint: "clear",
      calldata: [],
      why: `window elapsed, ${revealed}/${m.orders} revealed`,
    };
  }

  if (m.phase === "Cleared") {
    return { entrypoint: "settle_batch", calldata: ["0"], why: "applying fills" };
  }

  return null;
}

const short = (a) => `${a.slice(0, 10)}…${a.slice(-4)}`;

async function tick() {
  let markets;
  try {
    markets = await listMarkets();
  } catch (e) {
    log("could not read the factory:", e.message?.slice(0, 90));
    return;
  }

  for (const address of markets) {
    let m;
    try {
      m = await readMarket(address);
    } catch (e) {
      log(`${short(address)} unreadable:`, e.message?.slice(0, 70));
      continue;
    }

    let action;
    try {
      action = await nextAction(m);
    } catch (e) {
      log(`${short(address)} could not decide:`, e.message?.slice(0, 70));
      continue;
    }

    if (!action) {
      log(`${short(address)} round ${m.batch} ${m.phase.toLowerCase()}, ${m.orders} bets — nothing due`);
      continue;
    }

    try {
      const tx = await send(m.address, action.entrypoint, action.calldata);
      log(`${short(address)} ${action.entrypoint} (${action.why}) → ${tx.slice(0, 12)}…`);
      if (action.entrypoint === "settle_batch") revealingSince.delete(`${m.address}:${m.batch}`);
    } catch (e) {
      const msg = e.message ?? "";
      // WRONG_PHASE means somebody else advanced it first. That is the design working: the
      // calls are permissionless precisely so a market never depends on one keeper.
      if (msg.includes("WRONG_PHASE")) {
        log(`${short(address)} ${action.entrypoint} — already done by someone else`);
      } else {
        log(`${short(address)} ${action.entrypoint} failed:`, msg.slice(0, 110));
      }
    }
  }
}

log(`keeper up · factory ${short(FACTORY)} · as ${short(ADDRESS)}`);
log(`min bets ${MIN_BETS} · reveal window ${REVEAL_WINDOW_MS / 1000}s · poll ${POLL_MS / 1000}s`);
log("it will never reveal an order — that needs the bettor's own secret");

await tick();
if (!ONCE) {
  setInterval(() => {
    void tick();
  }, POLL_MS);
}
