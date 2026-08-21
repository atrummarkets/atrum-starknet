"use client";

/**
 * Autopilot — the app drives the batch so the user does not have to.
 *
 * WHY THIS EXISTS
 *
 * `close_batch`, `clear` and `settle_batch` are permissionless, and the earlier UI exposed
 * them as three buttons. That was me showing plumbing: a trader placing a bet should not have
 * to know a batch needs closing, let alone wait for a stranger to do it. So the app does it
 * when it comes due.
 *
 * AND REVEAL, WHICH IS THE DANGEROUS ONE
 *
 * Miss the reveal window and your order simply does not trade — escrow comes back, but the
 * trade you wanted never happened, and nothing tells you until it is too late. The salt is
 * already in this browser, so there is no reason a person should lose a trade to a clock.
 *
 * ANNOUNCED, NEVER SILENT
 *
 * Two rules this component follows on purpose:
 *
 *   Revealing makes your side and limit PUBLIC. Doing that without the user seeing it would
 *   be making a privacy decision on their behalf, which is not ours to make. So reveal is
 *   armed by default but always shows what it is about to do, and can be switched off.
 *
 *   Keeper calls spend the user's gas. Spending someone's money silently is worse than
 *   making them click. Every action names itself before it runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletAccountV6 } from "starknet";
import { listOrders, markRevealed, type StoredOrder } from "@/lib/atrum/orders";
import type { Market } from "@/lib/atrum/useMarket";

const NETNAME = process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia";

/**
 * Bets needed before a round closes.
 *
 * A round with one bet in it cannot match anything, so closing it just wastes gas. Two is
 * the floor at which a trade is possible at all.
 *
 * It is also the anonymity floor: everyone who trades in a round is indistinguishable
 * within it, so a round of two hides less than a round of twenty. Two is right for a
 * testnet demo and low for anything real -- the number is a privacy parameter, not just a
 * throughput one, and it belongs in the market's own configuration eventually.
 */
const MIN_BETS_TO_CLOSE = 2;

type Job = { label: string; entrypoint: string; calldata: string[]; why: string };

export function Autopilot({
  account,
  marketAddress,
  market,
  onChange,
}: {
  account: WalletAccountV6 | null;
  marketAddress: string;
  market: Market | null;
  onChange: () => void;
}) {
  const [armed, setArmed] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // A batch can be advanced once per phase; without this the poll fires the same call again
  // while the first is still in flight and the second reverts on WRONG_PHASE.
  const inFlight = useRef(false);
  /**
   * The phase we last acted on.
   *
   * The in-flight guard alone was not enough. Market state is polled every 12 seconds, so
   * after a call SUCCEEDS the UI can still be holding the old phase — and autopilot fires
   * again against a contract that has already moved on. That is where WRONG_PHASE came from:
   * a reveal attempted after the round had already cleared.
   */
  const actedOn = useRef<string | null>(null);

  const mine = listOrders(NETNAME).filter((o) => o.batch === market?.batch);
  // Only orders the contract confirms it holds. Revealing one it does not know about
  // would revert, and revert repeatedly on a poll.
  const unrevealed = mine.filter((o) => o.onChain && !o.revealed);

  /** What, if anything, is due right now. */
  const nextJob = useCallback((): Job | null => {
    if (!market) return null;

    // Reveal comes first: an unrevealed order is a trade about to be lost.
    if (market.phase === "Revealing" && unrevealed.length > 0) {
      const o = unrevealed[0] as StoredOrder;
      return {
        label: `Reveal your ${o.side === 1 ? "YES" : "NO"} order`,
        entrypoint: "reveal",
        calldata: [
          BigInt(o.holderSecret).toString(),
          o.side.toString(),
          o.limit.toString(),
          o.units,
          BigInt(o.salt).toString(),
        ],
        why: "Your side and limit become public now. Unrevealed orders do not trade.",
      };
    }

    // Rounds cycle on their OWN rhythm and close many times before the event resolves.
    // Gating this on `settleAfter` -- when the real-world question gets answered -- was a
    // straight confusion of two unrelated clocks, and it made a round look frozen for days.
    if (market.phase === "Open" && market.orderCount >= MIN_BETS_TO_CLOSE) {
      return {
        label: "Close this round",
        entrypoint: "close_batch",
        calldata: [],
        why: `${market.orderCount} bets are in — enough for a trade to be possible. Closing stops new ones and opens them all at once.`,
      };
    }

    // Last call: once the event itself is due, the round closes regardless of how thin it is.
    if (market.phase === "Open" && Date.now() / 1000 >= market.settleAfter) {
      return {
        label: "Close the final round",
        entrypoint: "close_batch",
        calldata: [],
        why: "The event is due to be settled, so no further bets can be accepted.",
      };
    }

    if (market.phase === "Revealing" && unrevealed.length === 0 && mine.length > 0) {
      return {
        label: "Clear the batch",
        entrypoint: "clear",
        calldata: [],
        why: "Everything of yours is revealed. Clearing finds the one price.",
      };
    }

    if (market.phase === "Cleared") {
      return {
        label: "Settle and open the next batch",
        entrypoint: "settle_batch",
        calldata: ["0"],
        why: "Applies fills to positions so you can act on them.",
      };
    }

    return null;
  }, [market, unrevealed, mine.length]);

  const job = nextJob();

  const run = useCallback(
    async (j: Job) => {
      if (!account || inFlight.current) return;
      inFlight.current = true;
      // Remember what we acted on so a stale poll cannot repeat it.
      actedOn.current = `${market?.batch}:${market?.phase}:${j.entrypoint}`;
      setRunning(j.label);
      try {
        const { transaction_hash } = await account.execute([
          { contractAddress: marketAddress, entrypoint: j.entrypoint, calldata: j.calldata },
        ]);
        if (j.entrypoint === "reveal") {
          const o = unrevealed[0];
          if (o) markRevealed(o.commitment);
        }
        setLog((l) => [`${j.label} — ${transaction_hash.slice(0, 12)}…`, ...l].slice(0, 4));
        onChange();
      } catch (e) {
        setLog((l) =>
          [`${j.label} failed — ${e instanceof Error ? e.message.slice(0, 70) : "error"}`, ...l].slice(0, 4),
        );
      } finally {
        inFlight.current = false;
        setRunning(null);
      }
    },
    [account, marketAddress, onChange, unrevealed],
  );

  useEffect(() => {
    if (!armed || !account || !job || running) return;
    // Refuse to repeat a call for a phase we have already acted on. The contract will have
    // moved on even if our copy of its state has not.
    if (actedOn.current === `${market?.batch}:${market?.phase}:${job.entrypoint}`) return;
    // A beat of delay so a user who just landed sees WHAT is about to happen before it does.
    const t = setTimeout(() => void run(job), 2500);
    return () => clearTimeout(t);
  }, [armed, account, job, running, run, market?.batch, market?.phase]);

  if (!market) return null;

  return (
    <div className="panel panel-tight">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <p className="panel-label" style={{ margin: 0 }}>
          Autopilot {armed ? "· on" : "· off"}
        </p>
        <button className="btn btn-ghost btn-sm" onClick={() => setArmed((a) => !a)}>
          {armed ? "Turn off" : "Turn on"}
        </button>
      </div>

      {job ? (
        <>
          <p className="notice" style={{ marginTop: "0.8rem" }}>
            <b>{running ? `${running}…` : `Next: ${job.label}`}</b>
            <br />
            {job.why}
          </p>
          {!armed && (
            <div className="btn-row" style={{ marginTop: "0.7rem" }}>
              <button className="btn btn-sm" disabled={!account} onClick={() => void run(job)}>
                Do it now
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="notice" style={{ marginTop: "0.8rem" }}>
          Nothing due. The batch advances itself when it needs to — you do not have to wait
          around for anyone.
        </p>
      )}

      {market.phase === "Open" && market.orderCount > 0 && market.orderCount < MIN_BETS_TO_CLOSE && (
        <p className="notice">
          {market.orderCount} bet{market.orderCount === 1 ? "" : "s"} in this round. A round
          needs at least {MIN_BETS_TO_CLOSE} before anything can match, so it stays open until
          someone else joins.
        </p>
      )}

      {unrevealed.length > 0 && market.phase === "Open" && (
        <p className="notice">
          {unrevealed.length} of your bets {unrevealed.length === 1 ? "is" : "are"} sealed in
          this round. Nothing for you to do — the round closes on its own.
        </p>
      )}

      {log.length > 0 && (
        <div className="orders" style={{ marginTop: "0.8rem" }}>
          {log.map((l, i) => (
            <div className="order-id" key={i} style={{ padding: "0.25rem 0" }}>
              {l}
            </div>
          ))}
        </div>
      )}

      <p className="notice">
        Closing, opening and settling a round take no permission from anyone, so the app does
        them rather than leaving you waiting. They cost a little gas, which is why each names
        itself before it runs.
      </p>
    </div>
  );
}
