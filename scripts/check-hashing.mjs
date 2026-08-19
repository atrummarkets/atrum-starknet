/**
 * Asserts the browser's commitment hashing matches Cairo's, exactly.
 *
 * If these ever diverge, an order becomes unrevealable and its escrow is stranded in the
 * contract with no diagnostic — both sides look correct in isolation. Reference values are
 * printed by `snforge test print_reference_hashes`.
 *
 *   node scripts/check-hashing.mjs
 */
import { hash, shortString } from "starknet";

const enc = (s) => BigInt(shortString.encodeShortString(s));
const HOLDER_TAG = enc("ATRUM_HOLDER:V1");
const COMMITMENT_TAG = enc("ATRUM_ORDER_COMMITMENT:V1");

const poseidon = (els) => BigInt(hash.computePoseidonHashOnElements(els));

const holder = (secret) => poseidon([HOLDER_TAG, BigInt(secret)]);
const commitment = (h, side, limit, units, salt) =>
  poseidon([COMMITMENT_TAG, h, BigInt(side), BigInt(limit), BigInt(units), BigInt(salt)]);

const h1 = holder(1n);
const h2 = holder(0x1234567890abcdefn);

const cases = [
  ["holder(1)", h1, 967879255745900690068658655214118063483330311513136740594238532047708425166n],
  [
    "commitment(h1,1,60,1,12345)",
    commitment(h1, 1, 60, 1n, 12345n),
    2628368733613961092882933722693634727919367747203517894817356579921640216977n,
  ],
  [
    "holder(0x1234567890abcdef)",
    h2,
    2932389491607367936442801835599534020272283289005365645475698199339422521629n,
  ],
  [
    "commitment(h2,2,35,1e18,0xdeadbeef)",
    commitment(h2, 2, 35, 10n ** 18n, 0xdeadbeefn),
    946433386206747787114907822288747755457907792324478154832735636910773816226n,
  ],
];

let bad = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) {
    console.log(`       cairo: ${want}`);
    console.log(`       js   : ${got}`);
  }
}

if (bad) {
  console.error(`\n${bad} mismatch(es). The browser and the contract disagree, so orders`);
  console.error("built by this client could never be revealed. Do NOT ship.");
  process.exit(1);
}
console.log("\nPASSED — browser hashing matches Cairo on all vectors.");
