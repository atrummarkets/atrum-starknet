"use client";

/**
 * Market state, read straight from the chain.
 *
 * Every number here comes from the contract, never from local state. A prediction market UI
 * that displays its own optimistic guesses is a UI that lies to people about money.
 */
import { useCallback, useEffect, useState } from "react";

import { provider } from "./wallet";

export type Phase = "Open" | "Revealing" | "Cleared" | "Resolved" | "Refunding";
const PHASES: Phase[] = ["Open", "Revealing", "Cleared", "Resolved", "Refunding"];

export type Market = {
  question: string;
  resolutionSource: string;
  phase: Phase;
  batch: number;
  orderCount: number;
  clearingPrice: number | null;
  outcome: 0 | 1 | 2;
  settleAfter: number;
  resolveDeadline: number;
  /**
   * How long bidders get to reveal after a round closes, in seconds, per the contract.
   *
   * Null only for a market predating the on-chain window. The app is pointed at a factory
   * whose markets all have it, so this is defensive rather than expected -- but the fallback
   * has to be "say nothing" rather than "assume a number", because the whole value of this
   * field is that it is a promise the chain is keeping.
   */
  revealWindow: number | null;
  /** Block timestamp at which this round stopped taking orders. Zero while still open. */
  closedAt: number;
  /**
   * Unix seconds after which `clear` will be accepted. Zero while the round is still open.
   *
   * This is the number the contract itself compares against, which is what makes it worth
   * showing a trader: it is not our estimate of when clearing happens, it is the rule.
   */
  clearableAt: number;
};

export type Position = {
  yesUnits: bigint;
  noUnits: bigint;
  collateral: bigint;
  staked: bigint;
};

/** ByteArray comes back as [len, ...words, pending_word, pending_len]. */
function decodeByteArray(felts: string[]): string {
  const wordCount = Number(felts[0]);
  let out = "";
  for (let i = 1; i <= wordCount; i++) out += feltToAscii(felts[i], 31);
  const pendingLen = Number(felts[wordCount + 2] ?? 0);
  if (pendingLen > 0) out += feltToAscii(felts[wordCount + 1], pendingLen);
  return out;
}

function feltToAscii(felt: string, bytes: number): string {
  let hex = BigInt(felt).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  hex = hex.padStart(bytes * 2, "0");
  let s = "";
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c) s += String.fromCharCode(c);
  }
  return s;
}

async function call(market: string, fn: string, calldata: string[] = []): Promise<string[]> {
  return provider().callContract({ contractAddress: market, entrypoint: fn, calldata });
}

export function useMarket(marketAddress: string, pollMs = 12_000) {
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [q, src, ph, b, oc, sa, rd] = await Promise.all([
        call(marketAddress, "get_question"),
        call(marketAddress, "get_resolution_source"),
        call(marketAddress, "get_phase"),
        call(marketAddress, "get_batch"),
        call(marketAddress, "get_outcome"),
        call(marketAddress, "get_settle_after"),
        call(marketAddress, "get_resolve_deadline"),
      ]);
      const batch = Number(BigInt(b[0]));
      const [cnt, price] = await Promise.all([
        call(marketAddress, "get_order_count", [batch.toString()]),
        call(marketAddress, "get_clearing_price", [batch.toString()]),
      ]);
      const p = Number(BigInt(price[0]));

      // Markets created before the reveal window moved on-chain do not have these views.
      // Treated as "unknown" rather than defaulted, so the UI stays silent instead of
      // promising a guarantee that market cannot make.
      let revealWindow: number | null = null;
      let closedAt = 0;
      try {
        const [rw, ca] = await Promise.all([
          call(marketAddress, "get_reveal_window"),
          call(marketAddress, "get_closed_at", [batch.toString()]),
        ]);
        revealWindow = Number(BigInt(rw[0]));
        closedAt = Number(BigInt(ca[0]));
      } catch {
        revealWindow = null;
      }
      setMarket({
        question: decodeByteArray(q),
        resolutionSource: decodeByteArray(src),
        phase: PHASES[Number(BigInt(ph[0]))] ?? "Open",
        batch,
        orderCount: Number(BigInt(cnt[0])),
        // Zero is not a price, it is "not cleared yet". Showing 0% would be a lie.
        clearingPrice: p === 0 ? null : p,
        outcome: Number(BigInt(oc[0])) as 0 | 1 | 2,
        settleAfter: Number(BigInt(sa[0])),
        resolveDeadline: Number(BigInt(rd[0])),
        revealWindow,
        closedAt,
        clearableAt: closedAt === 0 || revealWindow === null ? 0 : closedAt + revealWindow,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the market.");
    }
  }, [marketAddress]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { market, error, refresh };
}

export async function readPosition(marketAddress: string, holder: bigint): Promise<Position> {
  const r = await call(marketAddress, "get_position", [holder.toString()]);
  return {
    yesUnits: BigInt(r[0]),
    noUnits: BigInt(r[1]),
    collateral: BigInt(r[2]),
    staked: BigInt(r[3] ?? "0x0"),
  };
}
