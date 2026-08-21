/**
 * Local order keeping.
 *
 * THE MOST DANGEROUS DATA IN THIS APP.
 *
 * A sealed order is a commitment to `poseidon(holder, side, limit, units, salt)`. The chain
 * stores only the hash. If the salt is lost, the order can never be revealed — the escrow
 * sits in the contract, unspendable by anyone including us, forever.
 *
 * So: written to localStorage on submit BEFORE the transaction is sent, not after. A
 * transaction that lands while the browser tab dies would otherwise strand real money. The
 * cost of an orphan record for a transaction that never landed is a stale row; the cost of
 * the reverse is unrecoverable funds.
 *
 * The holder secret is likewise the only key to a position. `exportBackup()` exists so a
 * user can get their secrets out, and the UI should push them to use it.
 */
import { hash, shortString } from "starknet";

const KEY = "atrum.strk20.v1";

export type StoredOrder = {
  commitment: string;
  holderSecret: string;
  side: 1 | 2;
  limit: number;
  units: string;
  salt: string;
  escrow: string;
  batch: number;
  network: string;
  /** Which market this order belongs to. Without it the list showed every market at once. */
  market: string;
  /** Absent if the client never received it — which happens, and does NOT mean the order
   *  failed. Never used to decide whether an order exists. */
  txHash?: string;
  /** Set once the CONTRACT confirms it holds this commitment. This is the only thing that
   *  proves an order is real. */
  onChain?: boolean;
  /** Set once the contract reports the order settled. A settled bet is no longer AT RISK --
   *  its stake became shares or a refund -- so counting it as riding overstates exposure. */
  settled?: boolean;
  submittedAt: number;
  revealed?: boolean;
};

type Store = { orders: StoredOrder[]; holderSecret?: string };

function read(): Store {
  if (typeof window === "undefined") return { orders: [] };
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") as Store;
  } catch {
    return { orders: [] };
  }
}

function write(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/**
 * One holder secret per browser, generated once and reused.
 *
 * Reused deliberately: a position only persists across batches if the pseudonym does, and
 * carrying a position across batches is the whole point of being able to exit early.
 *
 * The trade, stated plainly so the UI can state it too: orders sharing a pseudonym are
 * linkable TO EACH OTHER. They are never linkable to an address — STRK20 handles that. A
 * trader who wants batch-to-batch unlinkability rotates the secret and gives up carrying a
 * position, and that choice is theirs, not ours.
 */
export function holderSecret(): string {
  const s = read();
  if (s.holderSecret) return s.holderSecret;
  const secret = randomFelt();
  write({ ...s, holderSecret: secret });
  return secret;
}

export function rotateHolderSecret(): string {
  const s = read();
  const secret = randomFelt();
  write({ ...s, holderSecret: secret });
  return secret;
}

/** 248 bits of crypto randomness, safely inside the 252-bit felt range. */
export function randomFelt(): string {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  return (
    "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  );
}

export function saveOrder(o: StoredOrder) {
  const s = read();
  s.orders = [o, ...s.orders.filter((x) => x.commitment !== o.commitment)];
  write(s);
}

export function markTx(commitment: string, txHash: string) {
  const s = read();
  const o = s.orders.find((x) => x.commitment === commitment);
  if (o) {
    o.txHash = txHash;
    write(s);
  }
}

/**
 * Mark a record as confirmed on-chain.
 *
 * Called after asking the contract whether it holds the commitment, NOT after a promise
 * resolved. A transaction can land while the client loses its hash -- the relayer submits it
 * and the response never makes it back -- and when that happened the UI called a real,
 * funded order "not submitted". The chain is the authority on what exists; our bookkeeping
 * is not.
 */
export function markOnChain(commitment: string) {
  const s = read();
  const o = s.orders.find((x) => x.commitment === commitment);
  if (o && !o.onChain) {
    o.onChain = true;
    write(s);
  }
}

/** Record that the contract considers this order finished. */
export function markSettled(commitment: string) {
  const s = read();
  const o = s.orders.find((x) => x.commitment === commitment);
  if (o && !o.settled) {
    o.settled = true;
    write(s);
  }
}

export function markRevealed(commitment: string) {
  const s = read();
  const o = s.orders.find((x) => x.commitment === commitment);
  if (o) {
    o.revealed = true;
    write(s);
  }
}

/**
 * Orders for one market.
 *
 * Filtered by market as well as network. Filtering on network alone pooled every market's
 * orders into one list under a heading naming a single market — so a handful of orders looked
 * like a dozen.
 *
 * Records written before a transaction that never landed have no `txHash`. They are kept
 * rather than deleted, because a hash can arrive late and the salt is the only way to ever
 * reveal, but they are returned flagged so the UI can show them as what they are.
 */
export function listOrders(network: string, market?: string): StoredOrder[] {
  return read().orders.filter(
    (o) => o.network === network && (market === undefined || o.market === market),
  );
}

/**
 * Attempts the CONTRACT does not know about. Safe to remove: nothing was escrowed.
 *
 * Keyed on `onChain`, never on `txHash`. A missing hash means the client lost track of a
 * transaction; a missing on-chain record means there is no order.
 */
export function abandoned(network: string, market?: string): StoredOrder[] {
  return listOrders(network, market).filter((o) => !o.onChain);
}

/**
 * Drop records with no transaction hash.
 *
 * Only ever these. An order with a hash escrowed real collateral, and deleting its salt
 * would strand that collateral permanently — so the purge is deliberately unable to touch
 * one.
 */
export function purgeAbandoned(network: string, market?: string): number {
  const st = read();
  const before = st.orders.length;
  st.orders = st.orders.filter(
    (o) =>
      Boolean(o.onChain) ||
      o.network !== network ||
      (market !== undefined && o.market !== market),
  );
  write(st);
  return before - st.orders.length;
}

/** Everything needed to recover, as a file. The UI should nag until this is downloaded. */
export function exportBackup(): string {
  return JSON.stringify(read(), null, 2);
}

export function importBackup(json: string) {
  const incoming = JSON.parse(json) as Store;
  const cur = read();
  const seen = new Set(incoming.orders.map((o) => o.commitment));
  write({
    holderSecret: incoming.holderSecret ?? cur.holderSecret,
    orders: [...incoming.orders, ...cur.orders.filter((o) => !seen.has(o.commitment))],
  });
}

// ---------------------------------------------------------------------------
// Commitment hashing. MUST match Cairo exactly or nothing can ever be revealed.
//
//   HOLDER_TAG     = 'ATRUM_HOLDER:V1'
//   COMMITMENT_TAG = 'ATRUM_ORDER_COMMITMENT:V1'
//   holder     = poseidon([HOLDER_TAG, holder_secret])
//   commitment = poseidon([COMMITMENT_TAG, holder, side, limit, units, salt])
//
// The tags are short-string felts, the same encoding Cairo uses for a quoted literal.
// ---------------------------------------------------------------------------

const tag = (s: string): bigint => BigInt(shortString.encodeShortString(s));

export const HOLDER_TAG = tag("ATRUM_HOLDER:V1");
export const COMMITMENT_TAG = tag("ATRUM_ORDER_COMMITMENT:V1");

/**
 * `computePoseidonHashOnElements` is the JS counterpart of Cairo's
 * `poseidon_hash_span`, padding rule included. Verified against Cairo on four vectors by
 * `scripts/check-hashing.mjs`, which is the only reason to believe it.
 */
const poseidon = (els: bigint[]): bigint =>
  BigInt(hash.computePoseidonHashOnElements(els));

export function computeHolder(holderSecret: string): bigint {
  return poseidon([HOLDER_TAG, BigInt(holderSecret)]);
}

export function computeCommitment(
  holder: bigint,
  side: 1 | 2,
  limit: number,
  units: bigint,
  salt: string,
): bigint {
  return poseidon([
    COMMITMENT_TAG,
    holder,
    BigInt(side),
    BigInt(limit),
    units,
    BigInt(salt),
  ]);
}

/** Escrow for an order, mirroring `reveal`'s check in Cairo. */
export function escrowFor(side: 1 | 2, limit: number, units: bigint): bigint {
  return side === 1
    ? units * BigInt(limit)
    : units * BigInt(100 - limit);
}
