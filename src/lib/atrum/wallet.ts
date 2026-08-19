"use client";

/**
 * Wallet connection and the STRK20 action calls.
 *
 * The app never sees a viewing key, never discovers notes, and never proves anything. It
 * hands the wallet a list of actions and the wallet does the private work. That is the
 * entire point of this route — a dapp holding viewing keys is a dapp that can be breached
 * into deanonymising its own users.
 */
import { WalletAccountV6, RpcProvider, compareVersions, walletV6 } from "starknet";
/**
 * The wallet type comes from the copy of get-starknet-wallet-standard that STARKNET.JS
 * itself depends on (`-v6`), not the standalone package.
 *
 * Both are installed — starknet 10.4.0 pins its own — and their `RequestFn` types are
 * structurally incompatible, so mixing them produces a wall of TS2345 that looks like a
 * code bug and is really a dependency-graph bug. Importing from the copy starknet uses is
 * what makes the two agree. This is the version trap the STRK20 skill warns about, hit in
 * practice.
 */
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard-v6/features";
import type { STRK20_ACTION } from "@starknet-io/types-js";
import { CHAIN_ID, NET, POOL, POOL_FEE_FALLBACK, STRK } from "./config";

const RPC = {
  sepolia: "https://api.cartridge.gg/x/starknet/sepolia",
  mainnet: "https://rpc.starknet.lava.build:443",
} as const;

export const provider = () => new RpcProvider({ nodeUrl: RPC[NET] });

/**
 * Capability check by VERSION QUERY, never by calling a data method.
 *
 * The tempting shortcut is to call `strk20Balances` and see whether it throws. Do not:
 * reading balances triggers a wallet consent prompt for private data the app has no reason
 * to see, so feature-detection would demand a privacy decision from the user before they
 * have asked for anything.
 */
export async function supportsStrk20(
  wallet: WalletWithStarknetFeatures,
): Promise<boolean> {
  try {
    // A namespace function, not a method on the account — and it needs no connection, so
    // capability can be checked before asking the user for anything at all.
    const versions = await walletV6.supportedWalletApi(wallet);
    return versions.some((v: string) => compareVersions(v, "0.10.3") >= 0);
  } catch {
    return false;
  }
}

/**
 * Connect, then verify the wallet is on the network we expect.
 *
 * `connect`'s third argument is the CAIRO version, not the chain id — passing a chain id
 * there compiles under a loose type and then silently misconfigures the account. The chain
 * is checked afterwards instead, and a mismatch is surfaced rather than switched
 * automatically: silently moving someone's wallet to another network is not ours to do.
 */
export async function connect(wallet: WalletWithStarknetFeatures) {
  const account = await WalletAccountV6.connect(provider(), wallet);
  // `walletV6.requestChainId` asks the WALLET, which is the authority here — the
  // provider would only tell us what RPC we pointed at, which is not the same question.
  const chainId = await walletV6.requestChainId(wallet);
  if (!sameFelt(chainId, CHAIN_ID[NET])) {
    throw new Error(
      `Wallet is on chain ${chainId}, but this app is configured for ${NET}. Switch network in your wallet.`,
    );
  }
  return account;
}

/** Felt comparison. Padded and unpadded hex can name the same value. */
const sameFelt = (a: string, b: string) => BigInt(a) === BigInt(b);

/** Live pool fee. Displayed rather than assumed — a stale constant costs a signed, failing tx. */
export async function readPoolFee(): Promise<bigint> {
  try {
    const res = await provider().callContract({
      contractAddress: POOL[NET],
      entrypoint: "get_fee_amount",
      calldata: [],
    });
    return BigInt(res[0]);
  } catch {
    return POOL_FEE_FALLBACK[NET];
  }
}

/**
 * Shield STRK into the pool.
 *
 * TWO WALLET PROMPTS, and the UI must say so before the first one. The ERC-20 approve has
 * to land on-chain before the private deposit, so the wallet asks twice. Unlabelled, the
 * second prompt reads as a duplicate-transaction bug and users reject it.
 */
export function shieldActions(amount: bigint): STRK20_ACTION[] {
  return [{ type: "deposit", token: STRK, amount: amount.toString() }];
}

/**
 * Submit a sealed order.
 *
 * Two actions, one transaction:
 *   1. a `transfer` of "OPEN" creates the open note the helper's output lands in
 *   2. an `invoke` calls our helper, with the pool address and note id substituted
 *
 * `"OPEN"`, `"${poolAddress}"` and `"${openNoteIds[0]}"` are LITERAL STRINGS the wallet
 * replaces. Hex-normalising them breaks the substitution silently.
 *
 * Calldata order must match `privacy_invoke`'s Cairo signature exactly, because the pool
 * deserialises it straight into those parameters:
 *   operation, commitment, token, pool_address, units, salt, side, limit, holder_secret, note_id
 *
 * The order's real values (side, limit, salt, holder_secret) are ZERO here. They stay sealed
 * until reveal; the contract only needs the commitment now.
 */
export function submitOrderActions(
  market: string,
  commitment: bigint,
  units: bigint,
  userAddress: string,
): STRK20_ACTION[] {
  return [
    { type: "transfer", token: STRK, amount: "OPEN", recipient: userAddress },
    {
      type: "invoke",
      contract: market,
      calldata: [
        "0", // AuctionOperation::Submit
        commitment.toString(),
        STRK,
        "${poolAddress}",
        units.toString(),
        "0", // salt      — sealed
        "0", // side      — sealed
        "0", // limit     — sealed
        "0", // holder    — sealed
        "${openNoteIds[0]}",
      ],
    },
  ];
}

/** Withdraw a settled balance into an open note. The amount is public; the owner is not. */
export function withdrawActions(
  market: string,
  holderSecret: string,
  userAddress: string,
): STRK20_ACTION[] {
  return [
    { type: "transfer", token: STRK, amount: "OPEN", recipient: userAddress },
    {
      type: "invoke",
      contract: market,
      calldata: [
        "1", // AuctionOperation::Claim
        "0",
        STRK,
        "${poolAddress}",
        "0",
        "0",
        "0",
        "0",
        BigInt(holderSecret).toString(),
        "${openNoteIds[0]}",
      ],
    },
  ];
}

/**
 * Dry-run before spending. Builds and proves without submitting, which is the cheapest way
 * to catch a calldata-shape mistake — and calldata shape is the single most likely thing to
 * be wrong, because the pool deserialises it blind.
 */
export async function dryRun(account: WalletAccountV6, actions: STRK20_ACTION[]) {
  return account.strk20PrepareInvoke(actions, true);
}

export async function submit(account: WalletAccountV6, actions: STRK20_ACTION[]) {
  const { transaction_hash } = await account.strk20InvokeTransaction(actions);
  return transaction_hash;
}

/**
 * Wait, but bounded.
 *
 * Every private transaction is relayed, and a relayed hash can take a while to appear at the
 * chosen RPC. A timeout here means "submitted, confirmation not yet visible" — NOT failed.
 * The UI keeps the explorer link and resumes polling rather than telling the user their
 * money went nowhere.
 */
export async function waitBounded(txHash: string, ms = 90_000) {
  const p = provider();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await p.getTransactionReceipt(txHash);
      if (r) return { status: "confirmed" as const, receipt: r };
    } catch {
      // not indexed yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: "pending" as const };
}
