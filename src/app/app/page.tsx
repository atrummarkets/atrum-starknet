"use client";

/**
 * The markets index.
 *
 * Read from the factory's on-chain index, so a market a stranger creates appears here
 * without us shipping a build. That is the difference between "permissionless" as a claim
 * and as a property.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Shell } from "@/components/Shell";
import { useMarkets, type MarketCard } from "@/lib/atrum/useMarkets";
import { AUCTION_CLASS, EXPLORER, FACTORY, FACTORY_DEPLOYED, NET } from "@/lib/atrum/config";

const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";

const PHASE_LABEL: Record<string, string> = {
  Open: "Open",
  Revealing: "Revealing",
  Cleared: "Cleared",
  Resolved: "Resolved",
  Refunding: "Refunding",
};

function timeLeft(to: number) {
  const s = to - Math.floor(Date.now() / 1000);
  if (s <= 0) return { text: "settling", pct: 100 };
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  // Bar fills over the last fortnight, which is roughly the horizon these markets run on.
  const pct = Math.max(0, Math.min(100, 100 - (s / (14 * 86400)) * 100));
  return { text: d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`, pct };
}

function Card({ m }: { m: MarketCard }) {
  const t = timeLeft(m.settleAfter);
  return (
    <Link
      href={`/app/market/${m.address}`}
      className="card"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      }}
    >
      <div>
        <div className="card-top">
          <span>Batch #{m.batch}</span>
          <span className={`phase phase-${m.phase.toLowerCase()}`}>
            {PHASE_LABEL[m.phase]}
          </span>
        </div>
        <p className="card-q">{m.question}</p>
      </div>

      <div className="card-foot">
        <div className="card-price">
          {m.clearingPrice !== null ? (
            <>
              <b>{m.clearingPrice}</b>
              <span>YES</span>
              <em>last clear</em>
            </>
          ) : (
            <>
              <b>{m.orderCount}</b>
              <span>{m.orderCount === 1 ? "ORDER" : "ORDERS"}</span>
              <em>sealed</em>
            </>
          )}
        </div>
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${t.pct}%` }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-3)" }}>
          {t.text}
        </span>
      </div>
    </Link>
  );
}

export default function Markets() {
  const reduced = useReducedMotion();
  const { markets, error } = useMarkets();

  if (!APP_ENABLED) {
    return (
      <Shell>
        <div className="panel">
          <p className="panel-label">Not open yet</p>
          <p className="notice">
            The market is still being tested. <a href="/">Back to the waitlist</a>.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="section-head">
        <h2>Markets</h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-3)" }}>
          {markets ? `${markets.length} live` : "reading the chain…"}
        </span>
      </div>

      {error && (
        <p className="msg-line" data-kind="err">
          {error}
        </p>
      )}

      <motion.div
        className="cards"
        initial={reduced ? undefined : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {markets?.map((m) => (
          <Card key={m.address} m={m} />
        ))}
      </motion.div>

      {markets?.length === 0 && !FACTORY_DEPLOYED && (
        <p className="notice">
          <b>Atrum is not deployed on {NET} yet.</b> Nothing here is broken — there is simply
          no factory on this network. Switch to a network where it is live, or see
          DEPLOYMENTS.md for what exists where.
        </p>
      )}

      {markets?.length === 0 && FACTORY_DEPLOYED && (
        <p className="notice">No markets yet. Anyone can create one.</p>
      )}

      <div className="panel">
        <p className="panel-label">How this list works</p>
        <p className="notice">
          Every market here was deployed by the factory at{" "}
          <a href={`${EXPLORER[NET]}/contract/${FACTORY[NET]}`} target="_blank" rel="noreferrer">
            {FACTORY[NET].slice(0, 10)}…
          </a>
          , and they all run the same code —{" "}
          <a href={`${EXPLORER[NET]}/class/${AUCTION_CLASS[NET]}`} target="_blank" rel="noreferrer">
            class {AUCTION_CLASS[NET].slice(0, 10)}…
          </a>
          . The factory cannot be repointed at a different class, which is the only reason
          reading one market tells you anything about the next.
        </p>
        <p className="notice notice-warn">
          <b>Listing is not endorsement.</b> Anyone can create a market, and the creator sets
          its outcome. What stops that being a rug: the question and resolution source are
          fixed at creation, the outcome can only be published inside a stated window, and
          once that window passes <em>anyone</em> can refund every holder. A creator can be
          wrong. They cannot steal, and they cannot touch another market.
        </p>
      </div>
    </Shell>
  );
}
