"use client";

/**
 * Your orders, your position, and the exit.
 *
 * The exit gets its own panel because it is the whole argument: one YES plus one NO is worth
 * exactly 1 STRK whichever way the event goes, so holding both lets you cash out with no
 * counterparty and no outcome. Every pooled prediction market makes you wait; this does not.
 * Burying that in a menu would be hiding the point.
 */
import { useCallback, useEffect, useState } from "react";
import type { WalletAccountV6 } from "starknet";
import { fmtStrk } from "@/lib/atrum/config";
import {
  abandoned,
  computeHolder,
  exportBackup,
  holderSecret,
  listOrders,
  markOnChain,
  markRevealed,
  purgeAbandoned,
  type StoredOrder,
} from "@/lib/atrum/orders";
import { provider } from "@/lib/atrum/wallet";
import { readPosition, type Market, type Position } from "@/lib/atrum/useMarket";
import { submit, withdrawActions } from "@/lib/atrum/wallet";


const NETNAME = process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia";

/** Reveal, clear, settle and merge move no tokens, so they are ordinary calls — not
 *  privacy_invoke, and not routed through the pool. Anyone may make them. */
async function directCall(
  account: WalletAccountV6,
  market: string,
  entrypoint: string,
  calldata: string[],
) {
  const { transaction_hash } = await account.execute([
    { contractAddress: market, entrypoint, calldata },
  ]);
  return transaction_hash;
}

export function Positions({
  account,
  address,
  marketAddress,
  market,
  onChange,
}: {
  account: WalletAccountV6 | null;
  address: string;
  marketAddress: string;
  market: Market | null;
  onChange: () => void;
}) {
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });
  const [mergeUnits, setMergeUnits] = useState("1");

  /**
   * Reconcile local records against the contract before showing anything.
   *
   * For each order we know about, ask the market whether it holds that commitment. That is
   * the only reliable test: a transaction can land while the client loses its hash, and
   * trusting our own bookkeeping made a real, funded order display as "not submitted".
   *
   * Cheap to do — the commitment is already known locally, so it is one view call each.
   */
  const reload = useCallback(async () => {
    const local = listOrders(NETNAME, marketAddress);
    await Promise.all(
      local
        .filter((o) => !o.onChain)
        .map(async (o) => {
          try {
            const r = await provider().callContract({
              contractAddress: marketAddress,
              entrypoint: "get_order",
              calldata: [o.commitment],
            });
            // A non-zero escrow means the contract really holds it.
            if (BigInt(r[0]) !== 0n) markOnChain(o.commitment);
          } catch {
            /* leave it unconfirmed rather than guessing */
          }
        }),
    );
    setOrders(listOrders(NETNAME, marketAddress));
    try {
      setPos(await readPosition(marketAddress, computeHolder(holderSecret())));
    } catch {
      /* chain unreachable; leave the last known value rather than blanking it */
    }
  }, [marketAddress]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMsg({ k: "", t: "" });
    try {
      const tx = await fn();
      setMsg({ k: "ok", t: `${label} sent. ${tx.slice(0, 12)}…` });
      onChange();
      await reload();
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : `${label} failed.` });
    } finally {
      setBusy(null);
    }
  }

  const mergeable = pos ? (pos.yesUnits < pos.noUnits ? pos.yesUnits : pos.noUnits) : 0n;

  function download() {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `atrum-secrets-${NETNAME}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      {/* ---------- the exit ---------- */}
      {mergeable > 0n && (
        <div className="exit">
          <span className="exit-head">You can exit now</span>
          <p>
            You hold <b>{mergeable.toString()}</b> complete{" "}
            {mergeable === 1n ? "set" : "sets"} — a YES and a NO together. That is worth
            exactly {mergeable.toString()} STRK whichever way this resolves, so you can cash
            out immediately. No counterparty, no waiting for the outcome.
          </p>
          <div className="btn-row">
            <input
              className="tick"
              style={{ width: "5rem", textAlign: "center" }}
              value={mergeUnits}
              onChange={(e) => setMergeUnits(e.target.value)}
              aria-label="Sets to merge"
            />
            <button
              className="btn btn-sm"
              disabled={!account || busy !== null}
              onClick={() =>
                void run("Merge", () =>
                  directCall(account!, marketAddress, "merge", [
                    BigInt(holderSecret()).toString(),
                    (BigInt(mergeUnits || "0")).toString(),
                  ]),
                )
              }
            >
              {busy === "Merge" ? "Merging…" : "Merge to collateral"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- position ---------- */}
      <div className="panel">
        <p className="panel-label">Your position</p>
        <dl style={{ margin: 0 }}>
          <div className="stat-row">
            <dt>YES units</dt>
            <dd>{pos ? pos.yesUnits.toString() : "—"}</dd>
          </div>
          <div className="stat-row">
            <dt>NO units</dt>
            <dd>{pos ? pos.noUnits.toString() : "—"}</dd>
          </div>
          <div className="stat-row">
            <dt>Withdrawable</dt>
            <dd className="hi">{pos ? `${fmtStrk(pos.collateral)} STRK` : "—"}</dd>
          </div>
        </dl>

        <div className="btn-row" style={{ marginTop: "1rem" }}>
          {market?.phase === "Resolved" || market?.phase === "Refunding" ? (
            <button
              className="btn btn-sm btn-ghost"
              disabled={!account || busy !== null}
              onClick={() =>
                void run("Redeem", () =>
                  directCall(account!, marketAddress, "redeem", [BigInt(holderSecret()).toString()]),
                )
              }
            >
              {market.phase === "Refunding" ? "Claim refund" : "Redeem winnings"}
            </button>
          ) : null}

          <button
            className="btn btn-sm"
            disabled={!account || busy !== null || !pos || pos.collateral === 0n}
            onClick={() =>
              void run("Withdraw", () =>
                submit(account!, withdrawActions(marketAddress, holderSecret(), address)),
              )
            }
          >
            Withdraw to a private note
          </button>
        </div>

        <p className="notice notice-warn">
          Your order salts and holder secret live in this browser only. Lose them and the
          escrow cannot be revealed or claimed by anyone, including us.{" "}
          <button className="btn btn-ghost btn-sm" onClick={download}>
            Download backup
          </button>
        </p>
      </div>

      {/* ---------- orders ---------- */}
      <div className="panel">
        <p className="panel-label">Your orders · this market</p>
        {orders.length === 0 && <p className="msg-line">No orders yet.</p>}
        <div className="orders">
          {orders.map((o) => (
            <div className="order" key={o.commitment}>
              <div>
                <div className="order-terms">
                  <b>{o.side === 1 ? "YES" : "NO"}</b> · {o.units} unit
                  {o.units === "1" ? "" : "s"} · limit{" "}
                  <b>{o.side === 1 ? o.limit : 100 - o.limit}</b> · escrow{" "}
                  {fmtStrk(BigInt(o.escrow))} STRK
                </div>
                <div className="order-id">
                  batch {o.batch} · {o.commitment.slice(0, 14)}…
                </div>
              </div>
              <div className="btn-row">
                <span
                  className={`badge ${
                    !o.onChain ? "badge-sealed" : o.revealed ? "badge-revealed" : "badge-filled"
                  }`}
                  style={!o.onChain ? { opacity: 0.55 } : undefined}
                >
                  {/* Status comes from the CONTRACT, not from whether we captured a hash. */}
                  {!o.onChain ? "not on-chain" : o.revealed ? "revealed" : "sealed"}
                </span>
                {o.onChain && !o.revealed && market?.phase === "Revealing" && (
                  <button
                    className="btn btn-sm"
                    disabled={!account || busy !== null}
                    onClick={() =>
                      void run("Reveal", async () => {
                        const tx = await directCall(account!, marketAddress, "reveal", [
                          BigInt(o.holderSecret).toString(),
                          o.side.toString(),
                          o.limit.toString(),
                          o.units,
                          BigInt(o.salt).toString(),
                        ]);
                        markRevealed(o.commitment);
                        return tx;
                      })
                    }
                  >
                    Reveal
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {orders.some((o) => !o.onChain) && (
          <p className="notice">
            {orders.filter((o) => !o.onChain).length} record
            {orders.filter((o) => !o.onChain).length === 1 ? "" : "s"} the contract does not
            hold — nothing was escrowed. A record is written before signing so a dying tab
            cannot strand funds, and these are the leftovers.{" "}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                purgeAbandoned(NETNAME, marketAddress);
                void reload();
              }}
            >
              Clear {abandoned(NETNAME, marketAddress).length} of them
            </button>
          </p>
        )}

        {market?.phase === "Revealing" && orders.some((o) => o.onChain && !o.revealed) && (
          <p className="notice notice-warn">
            Reveal before the batch clears or your order takes no part in it — the escrow
            comes back in full, but you will not have traded.
          </p>
        )}
      </div>

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </>
  );
}
