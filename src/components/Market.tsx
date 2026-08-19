"use client";

/**
 * The market. Question, phase, and the sealed-order count.
 *
 * The sealed count is the most important thing on this page and it is deliberately the
 * biggest: it shows ACTIVITY WITHOUT CONTENT. You can see that seven orders exist and
 * nothing about what they say. That is the product, on screen, rather than described in a
 * paragraph nobody reads.
 */
import type { Market } from "@/lib/atrum/useMarket";
import { EXPLORER, NET } from "@/lib/atrum/config";

const PHASE_COPY: Record<string, { cls: string; what: string }> = {
  Open: { cls: "phase-open", what: "Orders are being accepted. Nobody can read them." },
  Revealing: { cls: "phase-revealing", what: "Batch closed. Orders are opening — too late to add one." },
  Cleared: { cls: "phase-cleared", what: "Cleared at one price. Fills are being applied." },
  Resolved: { cls: "phase-resolved", what: "Settled. Winners can redeem." },
  Refunding: { cls: "phase-refunding", what: "The resolver missed the deadline. Everyone is refunded at cost." },
};

function countdown(to: number): string {
  const s = to - Math.floor(Date.now() / 1000);
  if (s <= 0) return "elapsed";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function MarketHeader({ market, address }: { market: Market | null; address: string }) {
  if (!market) {
    return (
      <div className="panel">
        <p className="panel-label">Market</p>
        <p className="msg-line">Reading the chain…</p>
      </div>
    );
  }

  const p = PHASE_COPY[market.phase] ?? PHASE_COPY.Open;

  return (
    <div className="panel">
      <h1 className="question">{market.question}</h1>

      <div className="meta-row" style={{ marginBottom: "1.1rem" }}>
        <span className={`phase ${p.cls}`}>{market.phase}</span>
        <span>
          Batch <b>#{market.batch}</b>
        </span>
        {market.clearingPrice !== null && (
          <span>
            Last clear <b>{market.clearingPrice}%</b>
          </span>
        )}
        <span>
          Settles in <b>{countdown(market.settleAfter)}</b>
        </span>
      </div>

      <p className="notice">{p.what}</p>

      <div className="sealed">
        <span className="sealed-n">{market.orderCount}</span>
        <span className="sealed-cap">
          {market.orderCount === 1 ? "order" : "orders"} in this batch
          {market.phase === "Open" && " — sealed, including from us"}
        </span>
      </div>

      <dl style={{ margin: 0 }}>
        <div className="stat-row">
          <dt>Resolution source</dt>
          <dd style={{ fontSize: "0.82rem", textAlign: "right", maxWidth: "22rem" }}>
            {market.resolutionSource}
          </dd>
        </div>
        <div className="stat-row">
          <dt>Refunds open if unresolved by</dt>
          <dd>{new Date(market.resolveDeadline * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
        </div>
        <div className="stat-row">
          <dt>Contract</dt>
          <dd style={{ fontSize: "0.8rem" }}>
            <a href={`${EXPLORER[NET]}/contract/${address}`} target="_blank" rel="noreferrer">
              {address.slice(0, 10)}…{address.slice(-6)}
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * What this market does and does not hide.
 *
 * On the page, not in a footer and not in a doc. A privacy product that makes people read a
 * whitepaper to find the limitations is a privacy product that misleads by layout.
 */
export function Disclosure() {
  return (
    <div className="panel">
      <p className="panel-label">What is public, and what is not</p>
      <table className="disclose">
        <thead>
          <tr>
            <th>Thing</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Who placed an order</td>
            <td className="is-hidden">hidden</td>
          </tr>
          <tr>
            <td>Which side you took, while the batch is open</td>
            <td className="is-hidden">hidden</td>
          </tr>
          <tr>
            <td>Your limit price, while the batch is open</td>
            <td className="is-hidden">hidden</td>
          </tr>
          <tr>
            <td>Your order size</td>
            <td className="yes-public">public</td>
          </tr>
          <tr>
            <td>Your side and limit, after the batch clears</td>
            <td className="yes-public">public</td>
          </tr>
          <tr>
            <td>Amounts entering and leaving the pool</td>
            <td className="yes-public">public</td>
          </tr>
        </tbody>
      </table>
      <p className="notice">
        Sealed-bid means sealed <em>until the close</em>, not sealed forever — that is what
        makes a clearing price checkable by anyone. What persists is unlinkability: nobody
        learns the orders were yours.
      </p>
      <p className="notice notice-warn">
        Unaudited. The outcome is set by a named address, not an oracle, so we can be
        <em> wrong</em> — but not silent: if we miss the deadline, anyone can call{" "}
        <code>force_refund</code> and everyone is refunded exactly what they paid.
      </p>
    </div>
  );
}
