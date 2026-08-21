"use client";

/**
 * Everything you have riding, across every market.
 *
 * THE FIX THIS PAGE EXISTS FOR
 *
 * It used to list settled positions only. Positions are created when a batch SETTLES, so
 * someone who had just placed three bets saw "no positions yet" and a zero balance while
 * several STRK of theirs sat escrowed in a contract. Technically accurate, and it reads as
 * "my money is gone".
 *
 * So open bets come first now, and settled positions after. Staked-but-unsettled is the
 * normal state of a batch auction — a bet waits for its round to close, and a page that only
 * understands the end state cannot show you the middle.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { fmtStrk } from "@/lib/atrum/config";
import {
  computeHolder,
  exportBackup,
  holderSecret,
  listOrders,
  markOnChain,
  markRevealed,
  markSettled,
  type StoredOrder,
} from "@/lib/atrum/orders";
import { readPosition, type Position } from "@/lib/atrum/useMarket";
import { useMarkets, type MarketCard } from "@/lib/atrum/useMarkets";
import { provider } from "@/lib/atrum/wallet";

const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";
const NETNAME = process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia";

type Row = { m: MarketCard; p: Position; open: StoredOrder[] };

export default function Portfolio() {
  const { markets } = useMarkets();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!markets) return;
    const holder = computeHolder(holderSecret());

    void (async () => {
      const all = await Promise.all(
        markets.map(async (m) => {
          const local = listOrders(NETNAME, m.address);

          // Reconcile against the contract rather than trusting our own bookkeeping. A
          // relayed transaction can land while the client loses its hash, and an order can
          // settle without the browser ever being open to see it.
          //
          // Order layout: escrow, batch, revealed, side, limit, units, filled, holder, settled
          await Promise.all(
            local
              .filter((o) => !o.settled)
              .map(async (o) => {
                try {
                  const r = await provider().callContract({
                    contractAddress: m.address,
                    entrypoint: "get_order",
                    calldata: [o.commitment],
                  });
                  if (BigInt(r[0]) !== 0n) markOnChain(o.commitment);
                  if (BigInt(r[2]) === 1n) markRevealed(o.commitment);
                  if (BigInt(r[8]) === 1n) markSettled(o.commitment);
                } catch {
                  /* leave as-is rather than guessing */
                }
              }),
          );

          // "Open" means still at risk. A settled bet became shares or a refund, and its
          // stake is represented by the position below rather than as money riding.
          const open = listOrders(NETNAME, m.address).filter((o) => o.onChain && !o.settled);
          const p = await readPosition(m.address, holder);
          return { m, p, open };
        }),
      );
      setRows(
        all.filter(
          (r) => r.open.length > 0 || r.p.yesUnits || r.p.noUnits || r.p.collateral,
        ),
      );
    })();
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

  const staked =
    rows?.reduce((n, r) => n + r.open.reduce((k, o) => k + BigInt(o.escrow), 0n), 0n) ?? 0n;
  const withdrawable = rows?.reduce((n, r) => n + r.p.collateral, 0n) ?? 0n;
  const openCount = rows?.reduce((n, r) => n + r.open.length, 0) ?? 0;

  return (
    <Shell>
      <div className="section-head">
        <h2>Your bets</h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-3)" }}>
          {openCount} live
        </span>
      </div>

      {/* Two headline numbers, because a bet is either riding or finished. */}
      <div className="grid-2">
        <div className="panel">
          <p className="panel-label">Riding on open bets</p>
          <div className="sealed">
            <span className="sealed-n" style={{ fontVariantNumeric: "proportional-nums" }}>
              {fmtStrk(staked)}
            </span>
            <span className="sealed-cap">
              STRK staked and sealed, waiting for a round to close
            </span>
          </div>
        </div>
        <div className="panel">
          <p className="panel-label">Ready to take out</p>
          <div className="sealed">
            <span className="sealed-n" style={{ fontVariantNumeric: "proportional-nums" }}>
              {fmtStrk(withdrawable)}
            </span>
            <span className="sealed-cap">STRK you can withdraw privately</span>
          </div>
        </div>
      </div>

      {rows === null && <p className="msg-line">Reading the chain…</p>}

      {rows?.length === 0 && (
        <div className="panel">
          <p className="notice">
            Nothing yet. <Link href="/app">Find a market</Link>.
          </p>
        </div>
      )}

      {rows?.map(({ m, p, open }) => (
        <div className="panel" key={m.address}>
          <Link href={`/app/market/${m.address}`} style={{ textDecoration: "none" }}>
            <p className="card-q" style={{ marginTop: 0, fontSize: "1.08rem" }}>
              {m.question}
            </p>
          </Link>

          {open.length > 0 && (
            <>
              <p className="panel-label" style={{ margin: "1rem 0 0.4rem" }}>
                Open bets · round {m.batch}
              </p>
              <div className="orders">
                {open.map((o) => (
                  <div className="order" key={o.commitment}>
                    <div>
                      <div className="order-terms">
                        <b>{o.side === 1 ? "YES" : "NO"}</b> · {o.units} share
                        {o.units === "1" ? "" : "s"} · risking {fmtStrk(BigInt(o.escrow))} STRK
                      </div>
                      <div className="order-id">
                        {o.revealed ? "revealed — waiting to settle" : "sealed — nobody can read it"}
                      </div>
                    </div>
                    <span className={`badge ${o.revealed ? "badge-revealed" : "badge-filled"}`}>
                      {o.revealed ? "revealed" : "sealed"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="notice">
                These settle when the round closes and someone has taken the other side. Until
                then the stake is held by the contract, not by us.
              </p>
            </>
          )}

          {(p.yesUnits > 0n || p.noUnits > 0n || p.collateral > 0n) && (
            <dl style={{ margin: "1rem 0 0" }}>
              <div className="stat-row">
                <dt>YES / NO shares held</dt>
                <dd>
                  {p.yesUnits.toString()} / {p.noUnits.toString()}
                </dd>
              </div>
              <div className="stat-row">
                <dt>Ready to withdraw</dt>
                <dd className="hi">{fmtStrk(p.collateral)} STRK</dd>
              </div>
              {p.yesUnits > 0n && p.noUnits > 0n && (
                <div className="stat-row">
                  <dt>Matched pairs — you can cash out now</dt>
                  <dd className="hi">
                    {(p.yesUnits < p.noUnits ? p.yesUnits : p.noUnits).toString()}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      ))}

      <div className="panel">
        <p className="panel-label">This is the only copy</p>
        <p className="notice notice-warn">
          Your bets are tied to a secret held only in this browser. There is no account and no
          server copy — that is what makes them yours alone, and it means losing this browser
          loses them. Nobody can recover it, us included.{" "}
          <button className="btn btn-ghost btn-sm" onClick={download}>
            Download backup
          </button>
        </p>
      </div>
    </Shell>
  );
}
