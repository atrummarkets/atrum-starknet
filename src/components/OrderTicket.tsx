"use client";

/**
 * Placing a sealed order.
 *
 * The order is written to localStorage BEFORE the transaction is sent. If the tab dies
 * between signing and confirming, the salt still exists — and without the salt the order can
 * never be revealed and its escrow is stranded in the contract, unspendable by anyone
 * including us. An orphan record for a transaction that never landed is a stale row; the
 * reverse is unrecoverable money.
 */
import { useMemo, useState } from "react";
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
import { submit, submitOrderActions, waitBounded } from "@/lib/atrum/wallet";

export function OrderTicket({
  account,
  address,
  marketAddress,
  batch,
  canTrade,
  poolFee,
  onPlaced,
}: {
  account: WalletAccountV6 | null;
  address: string;
  marketAddress: string;
  batch: number;
  canTrade: boolean;
  poolFee: bigint;
  onPlaced: () => void;
}) {
  const [side, setSide] = useState<1 | 2>(1);
  const [limit, setLimit] = useState(60);
  const [units, setUnits] = useState("1");
  const [busy, setBusy] = useState(false);
  /** Staged, because proving takes real time and a frozen button reads as a hang. */
  const [stage, setStage] = useState<string>("");
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });

  const unitsBig = useMemo(() => {
    try {
      return BigInt(units || "0");
    } catch {
      return 0n;
    }
  }, [units]);

  // Escrow mirrors the contract's own check at reveal, so a mismatch is caught here rather
  // than by a revert after the user has signed.
  const escrow = escrowFor(side, limit, unitsBig);
  // A "unit" is 1 whole STRK of complete-set value, so escrow is denominated in 1/100ths.
  const escrowWei = escrow * 10n ** 16n;
  const total = escrowWei + poolFee;

  async function place() {
    if (!account || unitsBig <= 0n) return;
    setBusy(true);
    setMsg({ k: "", t: "" });
    try {
      const secret = holderSecret();
      const salt = randomFelt();
      const holder = computeHolder(secret);
      const commitment = computeCommitment(holder, side, limit, unitsBig, salt);

      // Saved BEFORE anything is signed. See the note at the top of this file.
      saveOrder({
        commitment: "0x" + commitment.toString(16),
        holderSecret: secret,
        side,
        limit,
        units: unitsBig.toString(),
        salt,
        escrow: escrowWei.toString(),
        batch,
        network: process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia",
        market: marketAddress,
        submittedAt: Date.now(),
      });

      const actions = submitOrderActions(marketAddress, commitment, escrowWei, unitsBig, address);

      // NO DRY RUN HERE, deliberately.
      //
      // `strk20PrepareInvoke` builds AND PROVES the transaction. Calling it before every
      // submit means proving twice for one order -- doubling the slowest step and, in at
      // least one wallet, raising a second confirmation that reads as the order having
      // already gone through. It is the right tool for finding a calldata bug once, not for
      // the happy path forever.
      setStage("Proving in your wallet — this takes a moment");
      const tx = await submit(account, actions);
      markTx("0x" + commitment.toString(16), tx);
      setStage("");
      setMsg({ k: "ok", t: `Sealed and submitted. ${tx.slice(0, 12)}…` });
      onPlaced();

      // Confirmation runs in the BACKGROUND and does not hold the button.
      //
      // The order is placed the moment `submit` resolves; blocking on confirmation kept the
      // button reading "Sealing…" for up to two minutes AFTER the order was already
      // on-chain. A control that says it is still working when it is finished is worse than
      // no feedback -- it invites the user to try again and double-submit.
      void waitBounded(tx, 120_000).then((res) => {
        setMsg(
          res.status === "confirmed"
            ? { k: "ok", t: `Order is on-chain. ${tx.slice(0, 12)}…` }
            : { k: "ok", t: `Submitted. Not indexed at the RPC yet — that is normal for a relayed transaction. ${tx.slice(0, 12)}…` },
        );
        onPlaced();
      });
    } catch (e) {
      setStage("");
      setMsg({
        k: "err",
        t: e instanceof Error ? e.message : "Could not place the order.",
      });
    } finally {
      // Cleared here rather than after confirmation: the work the user asked for is done.
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p className="panel-label">Step two · place a sealed order</p>

      <div className="sides">
        <button
          className="side-btn"
          aria-pressed={side === 1}
          onClick={() => setSide(1)}
        >
          Buy YES
          <small>pays out if it happens</small>
        </button>
        <button
          className="side-btn"
          aria-pressed={side === 2}
          onClick={() => setSide(2)}
        >
          Buy NO
          <small>pays out if it does not</small>
        </button>
      </div>

      <div className="field">
        <label>Limit price — the most you will pay per unit</label>
        <div className="ticks">
          {PRICES.map((p) => (
            <button
              key={p}
              className="tick"
              aria-pressed={limit === p}
              onClick={() => setLimit(p)}
            >
              {side === 1 ? p : 100 - p}
            </button>
          ))}
        </div>
        <span className="hint">
          {side === 1
            ? `You pay up to ${limit} per unit for YES.`
            : `You pay up to ${100 - limit} per unit for NO — the same trade as selling YES at ${limit}.`}
        </span>
      </div>

      <div className="field">
        <label>Units</label>
        <input
          type="number"
          min="1"
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          inputMode="numeric"
        />
        <span className="hint">
          One unit pays 1 STRK if you are right, 0 if not.
        </span>
      </div>

      <dl style={{ margin: "0 0 1rem" }}>
        <div className="stat-row">
          <dt>Escrow</dt>
          <dd>{fmtStrk(escrowWei)} STRK</dd>
        </div>
        <div className="stat-row">
          <dt>Pool fee</dt>
          <dd>{fmtStrk(poolFee)} STRK</dd>
        </div>
        <div className="stat-row">
          <dt>Total</dt>
          <dd className="hi">{fmtStrk(total)} STRK</dd>
        </div>
      </dl>

      <button
        className="btn btn-wide"
        disabled={!account || !canTrade || busy || unitsBig <= 0n}
        onClick={() => void place()}
      >
        {busy ? "Sealing…" : "Seal and submit"}
      </button>

      {!canTrade && (
        <p className="notice">
          This batch is closed to new orders. The next one opens once this one settles.
        </p>
      )}

      <p className="notice">
        Needs a shielded balance. If this fails with <code>NOT_REGISTERED</code> or{" "}
        <code>BAD_ESCROW</code>, shield first and give the note ten blocks to mature.
      </p>

      <p className="notice">
        The pool fee is charged per private operation and is not sponsored — it is counted in
        the total above rather than surprising you after you sign.
      </p>

      {stage && <p className="msg-line">{stage}…</p>}

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </div>
  );
}
