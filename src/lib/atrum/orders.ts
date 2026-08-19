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
  txHash?: string;
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

export function markRevealed(commitment: string) {
  const s = read();
  const o = s.orders.find((x) => x.commitment === commitment);
  if (o) {
    o.revealed = true;
    write(s);
  }
}

export function listOrders(network: string): StoredOrder[] {
  return read().orders.filter((o) => o.network === network);
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
