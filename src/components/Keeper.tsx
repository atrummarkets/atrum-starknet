"use client";

/**
 * The keeper controls — closing, clearing and settling a batch.
 *
 * TUCKED AWAY, BUT NOT HIDDEN. These are operational, not trading: nobody placing a bet
 * needs them, and sitting them beside the order ticket made the page read like a control
 * panel instead of a market.
 *
 * They stay reachable by anyone, though, because the contract genuinely has no owner check
 * on them — a market must not stall waiting for us to wake up. Collapsing them behind a
 * disclosure is a layout decision; putting them behind an ADMIN flag would be a claim about
 * the trust model, and a false one.
 *
 * `force_refund` is the exception and does NOT stay collapsed: once the deadline passes it
 * surfaces on its own, because at that point it is the most important thing on the page.
 */
import { useState } from "react";
import type { WalletAccountV6 } from "starknet";

import type { Market } from "@/lib/atrum/useMarket";

export function Keeper({
  account,
  address,
  market,
  onChange,
}: {
  account: WalletAccountV6 | null;
  address: string;
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
        { contractAddress: address, entrypoint, calldata },
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
    <div className="panel panel-tight">
      {/* Surfaced unconditionally: past the deadline, a refund is the headline, not an
          advanced option. */}
      {pastDeadline && phase !== "Resolved" && phase !== "Refunding" && (
        <>
          <p className="panel-label" style={{ color: "var(--atrum-ember)" }}>
            Resolver missed the deadline
          </p>
          <p className="notice notice-warn" style={{ marginTop: 0 }}>
            No outcome was published in time. Anyone may now open refunds, and every holder
            gets back exactly what they paid. This is the check on the one power we kept.
          </p>
          <div className="btn-row" style={{ margin: "0.9rem 0 0.4rem" }}>
            <button
              className="btn btn-sm"
              disabled={!account || busy !== null}
              onClick={() => void call("Force refund", "force_refund")}
            >
              Force refund
            </button>
          </div>
        </>
      )}

      <details>
        <summary className="keeper-toggle">
          Manual controls
          <span className="keeper-note">autopilot handles these — here if you want them</span>
        </summary>

        <p className="notice" style={{ marginTop: "0.9rem" }}>
          A batch does not advance on its own — someone has to close it, clear it, and settle
          it. The contract has no owner check on any of the three, so whoever calls first
          moves the market on. Autopilot does this for you; these are here because the market
          should never depend on our UI being open.
        </p>

      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
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
          The one thing that is <em>not</em> permissionless is publishing the outcome — that is
          a named address. If it never does, the refund above is how you get out.
        </p>
      </details>

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </div>
  );
}
