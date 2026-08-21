"use client";

/**
 * Placing a bet.
 *
 * WRITTEN FOR SOMEONE WHO IS NOT A TRADER.
 *
 * The earlier version asked for "5 units at limit 60 on a 5-point grid" and showed an
 * "escrow". Nobody thinks that way. A person thinks: I reckon YES, here is what I will risk,
 * here is what I win. So simple mode asks for a number of shares and states both figures in
 * money; the limit-price grid moves behind Advanced, where a trader can find it.
 *
 * The default limit is deliberately generous — you are saying "I will pay up to this" — and
 * because every trade in a batch settles at ONE clearing price, you usually pay less than
 * your limit. That is worth telling people, because paying less than you offered is
 * counter-intuitive if you have only used order books.
 *
 * The record is written to localStorage BEFORE anything is signed. Without the salt an order
 * can never be revealed and its stake is stranded, so an orphan record is a stale row while
 * the reverse is unrecoverable money.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { WalletAccountV6 } from "starknet";
import { PRICES, fmtStrk } from "@/lib/atrum/config";
import {
  computeCommitment,
  computeHolder,
  escrowFor,
  holderSecret,
  markTx,
  randomFelt,
  saveOrder,
} from "@/lib/atrum/orders";
import { submit, submitOrderActions, waitForCommitment } from "@/lib/atrum/wallet";

/** A limit generous enough to fill in almost any batch. You will usually pay less. */
const DEFAULT_YES_LIMIT = 90;

export function OrderTicket({
  account,
  address,
  marketAddress,
  batch,
  canTrade,
  poolFee,
  enrolled,
  settleAfter,
  openOrdersSameSide,
  onPlaced,
}: {
  account: WalletAccountV6 | null;
  address: string;
  marketAddress: string;
  batch: number;
  canTrade: boolean;
  poolFee: bigint;
  enrolled: boolean | null;
  settleAfter: number;
  /** Your own resting orders on this side. Used to warn when nothing can match. */
  openOrdersSameSide: number;
  onPlaced: () => void;
}) {
  const [side, setSide] = useState<1 | 2>(1);
  const [shares, setShares] = useState("5");
  const [advanced, setAdvanced] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_YES_LIMIT);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });

  const units = useMemo(() => {
    try {
      return BigInt(shares || "0");
    } catch {
      return 0n;
    }
  }, [shares]);

  // `limit` is always the YES-equivalent price, which is what the contract wants. For a NO
  // bet the price a person pays is the complement, so the UI shows that instead.
  const pricePaid = side === 1 ? limit : 100 - limit;
  const stakePoints = escrowFor(side, limit, units);
  const stake = stakePoints * 10n ** 16n;
  const payout = units * 10n ** 18n; // one share pays exactly 1 STRK if you are right
  const total = stake + poolFee;

  const closesIn = (() => {
    const s = settleAfter - Math.floor(Date.now() / 1000);
    if (s <= 0) return "any moment";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `about ${d} day${d === 1 ? "" : "s"}` : h > 0 ? `about ${h}h` : `${m} min`;
  })();

  async function place() {
    if (!account || units <= 0n) return;
    setBusy(true);
    setMsg({ k: "", t: "" });
    try {
      const secret = holderSecret();
      const salt = randomFelt();
      const holder = computeHolder(secret);
      const commitment = computeCommitment(holder, side, limit, units, salt);

      saveOrder({
        commitment: "0x" + commitment.toString(16),
        holderSecret: secret,
        side,
        limit,
        units: units.toString(),
        salt,
        escrow: stake.toString(),
        batch,
        network: process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia",
        market: marketAddress,
        submittedAt: Date.now(),
      });

      const commitmentHex = "0x" + commitment.toString(16);
      setStage("Your wallet is sealing the bet — this takes up to a minute");

      // THE CHAIN IS THE SOURCE OF TRUTH, NOT THE PROMISE.
      //
      // `strk20InvokeTransaction` lands the transaction and then, often, never resolves.
      // Awaiting it left the button stuck on "Sealing…" over bets that had already
      // succeeded — three times out of three. So the submit is fired and NOT awaited as the
      // signal; what we wait on is the contract confirming it holds the commitment.
      submit(account, submitOrderActions(marketAddress, commitment, stake, units, address))
        .then((tx) => markTx(commitmentHex, tx))
        .catch(() => {
          /* the poll below decides; a rejected promise does not mean a failed order */
        });

      const landed = await waitForCommitment(marketAddress, commitmentHex, 180_000);
      setStage("");
      if (landed) {
        setMsg({ k: "ok", t: "Bet placed and sealed. Nobody can read it." });
      } else {
        setMsg({
          k: "err",
          t: "No bet appeared on-chain within three minutes. Nothing was staked — check your wallet before retrying.",
        });
      }
      onPlaced();
    } catch (e) {
      setStage("");
      setMsg({ k: "err", t: e instanceof Error ? e.message : "Could not place the bet." });
    } finally {
      setBusy(false);
    }
  }

  if (enrolled !== true) {
    return (
      <div className="panel">
        <p className="panel-label">Place a bet</p>
        <p className="notice notice-warn">
          You need to join the privacy pool first — one transaction, once ever.
        </p>
        <div className="btn-row" style={{ marginTop: "0.9rem" }}>
          <Link className="btn" href="/app/setup">
            Get set up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="panel-label">Place a bet</p>

      <div className="sides">
        <button
          className="side-btn"
          aria-pressed={side === 1}
          onClick={() => setSide(1)}
        >
          YES
          <small>pays if it happens</small>
        </button>
        <button
          className="side-btn"
          aria-pressed={side === 2}
          onClick={() => setSide(2)}
        >
          NO
          <small>pays if it doesn&apos;t</small>
        </button>
      </div>

      <div className="field">
        <label>How many shares</label>
        <input
          type="number"
          min="1"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          inputMode="numeric"
        />
        <span className="hint">Each share pays 1 STRK if you&apos;re right, nothing if not.</span>
      </div>

      {/* Money first. Two numbers, both in STRK, and nothing else. */}
      <dl style={{ margin: "0 0 1rem" }}>
        <div className="stat-row">
          <dt>You risk, at most</dt>
          <dd>{fmtStrk(stake)} STRK</dd>
        </div>
        <div className="stat-row">
          <dt>You get back if you&apos;re right</dt>
          <dd className="hi">{fmtStrk(payout)} STRK</dd>
        </div>
        <div className="stat-row">
          <dt>Network fee</dt>
          <dd>{fmtStrk(poolFee)} STRK</dd>
        </div>
      </dl>

      <button
        className="btn btn-wide"
        disabled={!account || !canTrade || busy || units <= 0n}
        onClick={() => void place()}
      >
        {busy ? "Sealing…" : `Bet ${fmtStrk(stake)} STRK on ${side === 1 ? "YES" : "NO"}`}
      </button>

      <p className="notice">
        <b>At most.</b> Every bet in a batch settles at one shared price, so you often pay
        less than this — never more.
      </p>

      {canTrade && (
        <p className="notice">
          This round closes in <b>{closesIn}</b>. Until then nobody — including us — can see
          your bet, which is what makes it impossible to trade against.
        </p>
      )}

      {/* The thing that had you confused: a bet with no opposite side cannot settle. */}
      {openOrdersSameSide > 0 && (
        <p className="notice notice-warn">
          You already have {openOrdersSameSide} bet{openOrdersSameSide === 1 ? "" : "s"} on{" "}
          {side === 1 ? "YES" : "NO"} this round, and nothing on the other side.{" "}
          <b>A bet only settles against someone taking the opposite view</b> — so nothing will
          happen until somebody bets {side === 1 ? "NO" : "YES"}.
        </p>
      )}

      {!canTrade && (
        <p className="notice">
          This round has closed. The next one opens as soon as this one settles.
        </p>
      )}

      <details style={{ marginTop: "0.6rem" }}>
        <summary className="keeper-toggle">
          Advanced
          <span className="keeper-note">set your own price</span>
        </summary>
        <div className="field" style={{ marginTop: "0.9rem" }}>
          <label>Most you&apos;ll pay per share</label>
          <div className="ticks">
            {PRICES.map((p) => {
              const shown = side === 1 ? p : 100 - p;
              return (
                <button
                  key={p}
                  className="tick"
                  aria-pressed={limit === p}
                  onClick={() => {
                    setLimit(p);
                    setAdvanced(true);
                  }}
                >
                  {shown}
                </button>
              );
            })}
          </div>
          <span className="hint">
            Currently {pricePaid} out of 100 per share. Lower means a better price and a
            smaller chance of the bet being taken at all.
            {advanced ? "" : " Left generous by default so it fills."}
          </span>
        </div>
      </details>

      {stage && <p className="msg-line">{stage}…</p>}
      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </div>
  );
}
