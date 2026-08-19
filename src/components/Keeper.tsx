"use client";

/**
 * The keeper panel — closing, clearing and settling a batch.
 *
 * These are exposed to EVERYONE, not hidden behind an admin flag, because the contract makes
 * them permissionless and a UI that pretends otherwise misrepresents the trust model. Anyone
 * can drive the batch forward; nobody has to wait for us to be awake.
 *
 * The one thing that is not permissionless is `resolve`, and that is stated rather than
 * styled to look the same.
 */
import { useState } from "react";
import type { WalletAccountV6 } from "starknet";
import { AUCTION, NET } from "@/lib/atrum/config";
import type { Market } from "@/lib/atrum/useMarket";

export function Keeper({
  account,
  market,
  onChange,
}: {
  account: WalletAccountV6 | null;
  market: Market | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });

  async function call(label: string, entrypoint: string, calldata: string[] = []) {
    if (!account) return;
    setBusy(label);
    setMsg({ k: "", t: "" });
    try {
      const { transaction_hash } = await account.execute([
        { contractAddress: AUCTION[NET], entrypoint, calldata },
      ]);
      setMsg({ k: "ok", t: `${label} sent. ${transaction_hash.slice(0, 12)}…` });
      onChange();
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : `${label} failed.` });
    } finally {
      setBusy(null);
    }
  }

  const phase = market?.phase;
  const pastDeadline =
    market !== null && Math.floor(Date.now() / 1000) > market.resolveDeadline;

  return (
    <div className="panel">
      <p className="panel-label">Move the batch on · anyone can do this</p>

      <div className="btn-row">
        <button
          className="btn btn-sm btn-ghost"
          disabled={!account || busy !== null || phase !== "Open"}
          onClick={() => void call("Close batch", "close_batch")}
        >
          Close batch
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={!account || busy !== null || phase !== "Revealing"}
          onClick={() => void call("Clear", "clear")}
        >
          Clear at one price
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={!account || busy !== null || phase !== "Cleared"}
          onClick={() => void call("Settle", "settle_batch", ["0"])}
        >
          Settle and open next
        </button>
      </div>

      <p className="notice">
        Closing, clearing and settling take no permission — the contract has no owner check on
        any of them. Whoever calls first moves the market on, so it cannot stall because we are
        asleep.
      </p>

      {pastDeadline && phase !== "Resolved" && phase !== "Refunding" && (
        <>
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button
              className="btn btn-sm"
              disabled={!account || busy !== null}
              onClick={() => void call("Force refund", "force_refund")}
            >
              Force refund — resolver missed the deadline
            </button>
          </div>
          <p className="notice notice-warn">
            The resolve deadline has passed with no outcome. Anyone may now open refunds, and
            every holder gets back exactly what they paid. This is the check on the one power
            we kept.
          </p>
        </>
      )}

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </div>
  );
}
