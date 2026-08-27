"use client";

/**
 * The market list, read from the factory's on-chain index.
 *
 * Not a hardcoded array. A market someone else creates has to appear without us shipping a
 * build, or "permissionless creation" is a claim the product contradicts.
 */
import { useCallback, useEffect, useState } from "react";
import { FACTORY, FACTORY_DEPLOYED, NET } from "./config";
import { provider } from "./wallet";
import { decodeByteArray, type Phase, PHASES } from "./decode";

export type MarketCard = {
  address: string;
  creator: string;
  question: string;
  phase: Phase;
  batch: number;
  orderCount: number;
  clearingPrice: number | null;
  settleAfter: number;
  resolveDeadline: number;
  outcome: 0 | 1 | 2;
};

const call = (contractAddress: string, entrypoint: string, calldata: string[] = []) =>
  provider().callContract({ contractAddress, entrypoint, calldata });

async function loadOne(address: string, creator: string): Promise<MarketCard> {
  const [q, ph, b, oc, sa, rd] = await Promise.all([
    call(address, "get_question"),
    call(address, "get_phase"),
    call(address, "get_batch"),
    call(address, "get_outcome"),
    call(address, "get_settle_after"),
    call(address, "get_resolve_deadline"),
  ]);
  const batch = Number(BigInt(b[0]));
  const [cnt, price] = await Promise.all([
    call(address, "get_order_count", [batch.toString()]),
    call(address, "get_clearing_price", [batch.toString()]),
  ]);
  const p = Number(BigInt(price[0]));
  return {
    address,
    creator,
    question: decodeByteArray(q),
    phase: PHASES[Number(BigInt(ph[0]))] ?? "Open",
    batch,
    orderCount: Number(BigInt(cnt[0])),
    clearingPrice: p === 0 ? null : p,
    settleAfter: Number(BigInt(sa[0])),
    resolveDeadline: Number(BigInt(rd[0])),
    outcome: Number(BigInt(oc[0])) as 0 | 1 | 2,
  };
}

export function useMarkets(pollMs = 20_000) {
  const [markets, setMarkets] = useState<MarketCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Nothing deployed on this network. An empty list is the truth here, and it lets the page
    // say so plainly instead of relaying an RPC complaint about the zero address.
    if (!FACTORY_DEPLOYED) {
      setMarkets([]);
      setError(null);
      return;
    }
    try {
      const cnt = Number(BigInt((await call(FACTORY[NET], "market_count"))[0]));
      const refs = await Promise.all(
        Array.from({ length: cnt }, (_, i) =>
          call(FACTORY[NET], "market_at", [i.toString()]),
        ),
      );
      const loaded = await Promise.all(
        // MarketRef is { address, creator, created_at, settle_after }.
        refs.map((r) => loadOne(r[0], r[1])),
      );
      // Newest first: a market created a minute ago is the one someone is looking for.
      setMarkets(loaded.reverse());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the market list.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { markets, error, refresh };
}
