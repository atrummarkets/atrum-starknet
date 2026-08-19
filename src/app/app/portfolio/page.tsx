"use client";

/**
 * Positions across every market.
 *
 * Read per market from the chain against this browser's holder pseudonym. There is no
 * server and no account: if you clear this browser's storage without exporting the backup,
 * nobody can reconstruct which positions were yours — including us. The page says so.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { fmtStrk } from "@/lib/atrum/config";
import { computeHolder, exportBackup, holderSecret, listOrders } from "@/lib/atrum/orders";
import { readPosition, type Position } from "@/lib/atrum/useMarket";
import { useMarkets, type MarketCard } from "@/lib/atrum/useMarkets";

const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";
const NETNAME = process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia";

type Row = { m: MarketCard; p: Position };

export default function Portfolio() {
  const { markets } = useMarkets();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orderCount, setOrderCount] = useState(0);

  useEffect(() => {
    if (!markets) return;
    const holder = computeHolder(holderSecret());
    void Promise.all(
      markets.map(async (m) => ({ m, p: await readPosition(m.address, holder) })),
    ).then((all) =>
      // Only markets you actually touched. An empty row per market would bury the signal.
      setRows(all.filter((r) => r.p.yesUnits || r.p.noUnits || r.p.collateral)),
    );
    setOrderCount(listOrders(NETNAME).length);
  }, [markets]);

  function download() {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `atrum-secrets-${NETNAME}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!APP_ENABLED) {
    return (
      <Shell>
        <div className="panel">
          <p className="panel-label">Not open yet</p>
          <p className="notice">
            Still being tested. <a href="/">Back to the waitlist</a>.
          </p>
        </div>
      </Shell>
    );
  }

  const totalOwed = rows?.reduce((n, r) => n + r.p.collateral, 0n) ?? 0n;

  return (
    <Shell>
      <div className="section-head">
        <h2>Portfolio</h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-3)" }}>
          {orderCount} order{orderCount === 1 ? "" : "s"} placed from this browser
        </span>
      </div>

      <div className="panel">
        <p className="panel-label">Withdrawable across all markets</p>
        <div className="sealed">
          <span className="sealed-n">{fmtStrk(totalOwed)}</span>
          <span className="sealed-cap">STRK ready to withdraw into a private note</span>
        </div>
      </div>

      {rows === null && <p className="msg-line">Reading positions…</p>}

      {rows?.length === 0 && (
        <div className="panel">
          <p className="notice">
            No positions yet. <Link href="/app">Find a market</Link>.
          </p>
        </div>
      )}

      {rows?.map(({ m, p }) => (
        <Link key={m.address} href={`/app/market/${m.address}`} className="panel" style={{ textDecoration: "none", display: "block" }}>
          <p className="card-q" style={{ marginTop: 0, fontSize: "1.1rem" }}>{m.question}</p>
          <dl style={{ margin: "0.9rem 0 0" }}>
            <div className="stat-row">
              <dt>YES / NO units</dt>
              <dd>
                {p.yesUnits.toString()} / {p.noUnits.toString()}
              </dd>
            </div>
            <div className="stat-row">
              <dt>Withdrawable</dt>
              <dd className="hi">{fmtStrk(p.collateral)} STRK</dd>
            </div>
            {p.yesUnits > 0n && p.noUnits > 0n && (
              <div className="stat-row">
                <dt>Complete sets — exit available</dt>
                <dd className="hi">
                  {(p.yesUnits < p.noUnits ? p.yesUnits : p.noUnits).toString()}
                </dd>
              </div>
            )}
          </dl>
        </Link>
      ))}

      <div className="panel">
        <p className="panel-label">This is the only copy</p>
        <p className="notice notice-warn">
          Your positions are held against a pseudonym derived from a secret in this browser,
          and your order salts live here too. There is no account and no server copy — clear
          this browser without a backup and nobody can prove which positions were yours,
          including us.{" "}
          <button className="btn btn-ghost btn-sm" onClick={download}>
            Download backup
          </button>
        </p>
      </div>
    </Shell>
  );
}
