"use client";

/**
 * A clock that ticks, for countdowns.
 *
 * Market state is polled every twelve seconds, which is fine for numbers that change when the
 * chain changes. It is not fine for a deadline: a reveal countdown that jumped in twelve-second
 * steps would read as broken, and near zero it would tell someone they had time when they did
 * not.
 */
import { useEffect, useState } from "react";

/** Unix seconds, re-rendering once a second. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * A deadline is compared against the BLOCK timestamp on chain, not against this browser's
 * clock, and the two are never exactly equal. A device running a minute fast would show a
 * reveal window as expired while the contract still accepted reveals, and — worse — would
 * show clearing as due while `clear` still reverted.
 *
 * So the two directions get different treatment, deliberately:
 *
 *   - telling someone how long they have  -> round DOWN, understate it, never promise time
 *     that might not be there
 *   - deciding whether to send `clear`    -> wait past the deadline by this margin, so a fast
 *     clock cannot make us spend gas on a transaction the chain will reject
 *
 * Fifteen seconds is a little over one Starknet block, which is the granularity the contract's
 * comparison actually has.
 */
export const CLOCK_MARGIN_SECONDS = 15;

/** "4m 12s", "58s", "2h 5m". Coarse above an hour, precise when it matters. */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** "60 minutes", "5 minutes" — for stating a window's length rather than counting it down. */
export function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 86400) {
    const d = seconds / 86400;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (seconds % 3600 === 0 && seconds >= 3600) {
    const h = seconds / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (seconds >= 60) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}
