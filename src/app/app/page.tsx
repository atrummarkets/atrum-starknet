"use client";

/**
 * The market page.
 *
 * One URL does both jobs: the market is at the top so a returning trader lands on the thing
 * they came for, and the explanation sits below it for someone arriving cold. A separate
 * marketing page would mean the demo link and the product link are different, which is one
 * more thing to get wrong in a three-minute video.
 */
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { WalletAccountV6 } from "starknet";
import { Connect } from "@/components/Connect";
import { Disclosure, MarketHeader } from "@/components/Market";
import { Keeper } from "@/components/Keeper";
import { OrderTicket } from "@/components/OrderTicket";
import { Positions } from "@/components/Positions";
import { NET, POOL_FEE_FALLBACK } from "@/lib/atrum/config";
import { useMarket } from "@/lib/atrum/useMarket";
import { readPoolFee } from "@/lib/atrum/wallet";

const rise = (delay: number, reduced: boolean | null) =>
  reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const },
      };

/**
 * Gated on purpose.
 *
 * The wallet flow has never run against a real wallet, so this must not be reachable from a
 * public URL by accident. Set NEXT_PUBLIC_ENABLE_APP=1 locally to work on it; production
 * shows the coming-soon page at / and nothing here.
 */
const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";

export default function Home() {
  const reduced = useReducedMotion();
  const { market, error, refresh } = useMarket();
  const [account, setAccount] = useState<WalletAccountV6 | null>(null);
  const [address, setAddress] = useState("");
  const [poolFee, setPoolFee] = useState<bigint>(POOL_FEE_FALLBACK[NET]);
  const [nonce, setNonce] = useState(0);

  // Read the live fee rather than trusting the constant. Wallet flows sponsor gas but not
  // the pool fee, so a stale number here becomes an operation that fails after signing.
  useEffect(() => {
    void readPoolFee().then(setPoolFee).catch(() => {});
  }, []);

  const bump = useCallback(() => {
    setNonce((n) => n + 1);
    void refresh();
  }, [refresh]);

  if (!APP_ENABLED) {
    return (
      <div className="app">
        <div className="panel">
          <p className="panel-label">Not open yet</p>
          <p className="notice">
            The market is still being tested. <a href="/">Back to the waitlist</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="atmos" aria-hidden="true">
        <div className="backdrop" />
        <div className="fog fog-a" />
        <div className="fog fog-b" />
      </div>

      <div className="app">
        <motion.header
          {...rise(0, reduced)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", padding: "0.5rem 0 0.25rem" }}
        >
          <span className="wordmark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-chrome.png" alt="Atrum" />
          </span>
          <span className="chain">Starknet · {NET}</span>
        </motion.header>

        <motion.div {...rise(0.08, reduced)}>
          <MarketHeader market={market} />
        </motion.div>

        {error && (
          <p className="msg-line" data-kind="err">
            {error}
          </p>
        )}

        <motion.div {...rise(0.16, reduced)}>
          <Connect
            account={account}
            onConnect={(a, addr) => {
              setAccount(a);
              setAddress(addr);
            }}
          />
        </motion.div>

        <motion.div className="grid-2" {...rise(0.24, reduced)}>
          <OrderTicket
            account={account}
            address={address}
            batch={market?.batch ?? 0}
            canTrade={market?.phase === "Open"}
            poolFee={poolFee}
            onPlaced={bump}
          />
          <div style={{ display: "grid", gap: "1.25rem", alignContent: "start" }}>
            <Positions
              key={nonce}
              account={account}
              address={address}
              market={market}
              onChange={bump}
            />
          </div>
        </motion.div>

        <motion.div {...rise(0.32, reduced)}>
          <Keeper account={account} market={market} onChange={bump} />
        </motion.div>

        <motion.div {...rise(0.4, reduced)}>
          <Disclosure />
        </motion.div>

        {/* ---------- how it works, for someone arriving cold ---------- */}
        <motion.div className="panel" {...rise(0.48, reduced)}>
          <p className="panel-label">How this works</p>
          <ul className="props" style={{ borderTop: "none" }}>
            <li>
              <span className="n">01</span>
              <span>
                <b>Orders go in sealed.</b> The chain stores a hash of your side, price and
                size — nothing readable. Not by other traders, not by us.
              </span>
            </li>
            <li>
              <span className="n">02</span>
              <span>
                <b>The batch closes, then opens.</b> Everything is already committed by then,
                so there is no moment where someone can see your order and still act on it.
                Front-running is not policed here; it is impossible.
              </span>
            </li>
            <li>
              <span className="n">03</span>
              <span>
                <b>One price for everyone.</b> The batch clears where demand meets supply.
                Ties go to the midpoint of the crossing range, so neither side gets handed the
                spread. Being fast buys nothing.
              </span>
            </li>
            <li>
              <span className="n">04</span>
              <span>
                <b>Leave whenever.</b> Buy the other side in a later batch and merge — a YES
                and a NO together are worth exactly 1 STRK however this resolves. No
                counterparty, no waiting for the result.
              </span>
            </li>
          </ul>
        </motion.div>

        <footer>
          <span>Built on Starknet · STRK20</span>
          <span>
            <a href="https://github.com/atrummarkets/atrum-starknet" target="_blank" rel="noreferrer">
              Source
            </a>
            {"  ·  "}
            <a href="https://x.com/AtrumMarkets" target="_blank" rel="noreferrer">
              @AtrumMarkets
            </a>
          </span>
        </footer>
      </div>
    </>
  );
}
