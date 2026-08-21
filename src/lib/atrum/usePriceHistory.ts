"use client";

/**
 * Clearing price per batch, read from the chain.
 *
 * A prediction market showing one number is a lottery ticket. Every batch that has cleared
 * recorded its price on-chain, so the history already exists — it just was not being read.
 *
 * UNCLEARED BATCHES ARE SKIPPED, NOT PLOTTED AS ZERO. `get_clearing_price` returns 0 for a
 * batch that never cleared, and drawing that would put a 0% probability on the chart, which
 * is a lie about what the market said. A gap is the truth.
 */
import { useCallback, useEffect, useState } from "react";
import { provider } from "./wallet";

export type Point = { batch: number; price: number };

export function usePriceHistory(marketAddress: string, currentBatch: number) {
  const [points, setPoints] = useState<Point[] | null>(null);

  const load = useCallback(async () => {
    if (!marketAddress) return;
    const p = provider();
    const reads = await Promise.all(
      Array.from({ length: Math.max(0, currentBatch + 1) }, async (_, i) => {
        try {
          const r = await p.callContract({
            contractAddress: marketAddress,
            entrypoint: "get_clearing_price",
            calldata: [i.toString()],
          });
          return { batch: i, price: Number(BigInt(r[0])) };
        } catch {
          return { batch: i, price: 0 };
        }
      }),
    );
    setPoints(reads.filter((r) => r.price > 0));
  }, [marketAddress, currentBatch]);

  useEffect(() => {
    void load();
  }, [load]);

  return points;
}
