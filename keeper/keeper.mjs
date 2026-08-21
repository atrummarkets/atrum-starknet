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
 *
 * WHY IT HOLDS NO STATE
 *
 * It used to. The reveal window — how long bidders get after a round closes, before it can be
 * cleared — was a timer in this process, and that was wrong in three ways at once. It was
 * unverifiable, because nobody outside could check the wait had happened. It was
 * unenforceable, because a keeper that skipped it looked identical on chain. And it was lost
 * on restart, which for anything deployed means lost on every deploy.
 *
 * The contract holds it now: `close_batch` stamps the time, `clear` refuses until the window
 * has passed, and the window is fixed when the market is created. So this process reads the
 * deadline rather than remembering it, and that single change is what makes it safe to
 * restart, safe to run several of, and safe for a stranger to run against your markets.
 *
 * Nothing here needs a disk, a database, or a graceful shutdown to stay correct.
 */
import { Account, RpcProvider } from "starknet";

const RPC = process.env.KEEPER_RPC ?? "https://api.cartridge.gg/x/starknet/sepolia";
const FACTORY = process.env.KEEPER_FACTORY;
const ADDRESS = process.env.KEEPER_ADDRESS;
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY;

const POLL_MS = Number(process.env.KEEPER_POLL_MS ?? 30_000);
const MIN_BETS = Number(process.env.KEEPER_MIN_BETS ?? 2);

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
  // Markets deployed before the reveal window moved on-chain do not have these views, and a
  // keeper cannot be stateless against them -- there is nothing on the chain to read. Rather
  // than quietly reintroducing an in-process timer for those, detect them and refuse: the
  // whole point is that the wait is verifiable, and for a legacy market it is not.
  let revealWindow, closedAt;
  try {
    const [windowRaw] = await view(address, "get_reveal_window");
    const [closedRaw] = await view(address, "get_closed_at", [batch.toString()]);
    revealWindow = Number(BigInt(windowRaw));
    closedAt = Number(BigInt(closedRaw));
  } catch {
    return { address, batch, legacy: true };
  }

  return {
    address,
    phase: PHASES[Number(BigInt(phaseRaw))] ?? "Open",
    batch,
    orders: Number(BigInt(countRaw)),
    revealWindow,
    closedAt,
    // Unix seconds, per the chain, after which `clear` will be accepted. Zero before the
    // round has closed. Read rather than remembered -- see the note at the top.
    clearableAt: closedAt === 0 ? 0 : closedAt + revealWindow,
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
    // The chain decides. Not "wait 180s from when this process first noticed" -- wait until
    // the block timestamp the contract itself will accept, which is the same instant for every
    // keeper watching this market and survives this process being restarted.
    const now = Math.floor(Date.now() / 1000);
    if (now < m.clearableAt) {
      const left = m.clearableAt - now;
      log(`  ${short(m.address)} round ${m.batch} reveals open for ${left}s more`);
      return null;
    }

    // Only worth an RPC round-trip per order once clearing is actually permitted, and only to
    // report what the round looked like -- not to decide anything. Deciding on this number
    // would reintroduce the discretion the window exists to remove.
    const revealed = await revealedCount(m.address, m.batch, m.orders);
    return {
      entrypoint: "clear",
      calldata: [],
      why: `window closed, ${revealed}/${m.orders} revealed`,
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

    if (m.legacy) {
      log(
        `${short(address)} SKIPPED — predates the on-chain reveal window. Nothing here can ` +
          `verify when its round closed, so advancing it would be exactly the unverifiable ` +
          `wait this keeper no longer does. Recreate it through a current factory.`,
      );
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
log(`min bets ${MIN_BETS} · poll ${POLL_MS / 1000}s · holds no state`);
log("reveal windows come from each market's contract, not from here");
log("it will never reveal an order — that needs the bettor's own secret");

/**
 * Ticks never overlap.
 *
 * A tick makes one RPC call per market plus one per order, so under load it can take longer
 * than the poll interval. A bare setInterval would then start a second pass while the first
 * was mid-flight, and both would decide the same market needed the same call — two
 * transactions from one account for one action, which collide on the nonce. One of them
 * fails, and the failure looks like a contract problem rather than a scheduling one.
 */
let running = false;
async function safeTick() {
  if (running) {
    log("previous pass still running, skipping this one");
    return;
  }
  running = true;
  try {
    await tick();
  } catch (e) {
    // A tick must never take the process down: whatever went wrong, the next pass re-reads
    // everything from the chain and has no stale state to recover from.
    log("pass failed:", e?.message?.slice(0, 140) ?? e);
  } finally {
    running = false;
  }
}

// A rejected promise nobody awaited used to be a silent exit. On a server that reads as the
// keeper "just stopping", with no line in the log saying why.
process.on("unhandledRejection", (e) => {
  log("unhandled rejection:", e?.message?.slice(0, 140) ?? e);
});

await safeTick();

if (!ONCE) {
  const timer = setInterval(() => {
    void safeTick();
  }, POLL_MS);

  // Platforms stop a worker with SIGTERM and follow up with SIGKILL. Nothing here needs to be
  // flushed — there is no state — so this exists only so the shutdown appears in the log
  // instead of the process vanishing.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      log(`${sig} — stopping. Rounds stay where they are; any keeper can pick them up.`);
      clearInterval(timer);
      process.exit(0);
    });
  }
}
