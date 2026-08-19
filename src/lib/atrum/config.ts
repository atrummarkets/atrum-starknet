/**
 * Network configuration.
 *
 * Addresses are hardcoded per network rather than read from env, because a wrong pool
 * address does not fail loudly — it fails as "the wallet rejected your order" and takes an
 * afternoon to find.
 */
export type Net = "sepolia" | "mainnet";

export const NET: Net =
  (process.env.NEXT_PUBLIC_STARKNET_NETWORK as Net) ?? "sepolia";

export const CHAIN_ID = {
  sepolia: "0x534e5f5345504f4c4941", // SN_SEPOLIA
  mainnet: "0x534e5f4d41494e", // SN_MAIN
} as const;

/** The STRK20 privacy pool. */
export const POOL = {
  sepolia: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  mainnet: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
} as const;

/** Our auction helper. Mainnet is deployed at submission time. */
export const AUCTION = {
  sepolia: "0x0440ac9d0615b17590ff588f6468d784cdc8ec5245f39711c518dbac56275e37",
  mainnet: "0x0",
} as const;

/** STRK. Same address on both networks. */
export const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * MEASURED flat pool fee per private operation, read from the pool's `get_fee_amount`.
 * Sepolia charges 2 STRK, mainnet 6.
 *
 * This is displayed, never assumed: `readPoolFee()` fetches the live value, and these are
 * only the fallback for a first paint. Wallet flows sponsor gas but NOT the pool fee, so a
 * MAX button that ignores it produces an operation that fails *after* the user signs.
 */
export const POOL_FEE_FALLBACK: Record<Net, bigint> = {
  sepolia: 2_000000000000000000n,
  mainnet: 6_000000000000000000n,
};

export const EXPLORER = {
  sepolia: "https://sepolia.voyager.online",
  mainnet: "https://voyager.online",
} as const;

/** Prices are whole percent on a 5-point grid. Must match Cairo's `TICK`. */
export const TICK = 5;
export const PRICES = Array.from({ length: 19 }, (_, i) => (i + 1) * TICK);

/** Two felts are the same address even when one is zero-padded. */
export const sameAddress = (a: string, b: string) => BigInt(a) === BigInt(b);

export const fmtStrk = (wei: bigint, dp = 2) =>
  (Number(wei) / 1e18).toFixed(dp);
