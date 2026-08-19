"use client";

/**
 * One market. Everything you can do with it.
 *
 * The order of the page is the order of the decision: what am I betting on, can I act, place
 * the bet, what do I hold. Keeper controls and the disclosure sit below that because nobody
 * placing a bet needs them first.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import type { WalletAccountV6 } from "starknet";
import { Shell } from "@/components/Shell";
import { Connect } from "@/components/Connect";
import { Shield } from "@/components/Shield";
import { Disclosure, MarketHeader } from "@/components/Market";
import { Keeper } from "@/components/Keeper";
import { OrderTicket } from "@/components/OrderTicket";
import { Positions } from "@/components/Positions";
import { NET, POOL_FEE_FALLBACK } from "@/lib/atrum/config";
import { useMarket } from "@/lib/atrum/useMarket";
import { readPoolFee } from "@/lib/atrum/wallet";

const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";

const rise = (delay: number, reduced: boolean | null) =>
  reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] as const },
      };

export default function MarketPage() {
  const reduced = useReducedMotion();
  const params = useParams<{ address: string }>();
  const marketAddress = params.address;

  const { market, error, refresh } = useMarket(marketAddress);
  const [account, setAccount] = useState<WalletAccountV6 | null>(null);
  const [address, setAddress] = useState("");
  const [poolFee, setPoolFee] = useState<bigint>(POOL_FEE_FALLBACK[NET]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void readPoolFee().then(setPoolFee).catch(() => {});
  }, []);

  const bump = useCallback(() => {
    setNonce((n) => n + 1);
    void refresh();
  }, [refresh]);

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
      <Link href="/app" className="back-link">
        ← All markets
      </Link>

      <motion.div {...rise(0, reduced)}>
        <MarketHeader market={market} address={marketAddress} />
      </motion.div>

      {error && (
        <p className="msg-line" data-kind="err">
          {error}
        </p>
      )}

      <motion.div {...rise(0.08, reduced)}>
        <Connect
          account={account}
          onConnect={(a, addr) => {
            setAccount(a);
            setAddress(addr);
          }}
        />
      </motion.div>

      <motion.div {...rise(0.14, reduced)}>
        <Shield account={account} poolFee={poolFee} onDone={bump} />
      </motion.div>

      <motion.div className="grid-2" {...rise(0.22, reduced)}>
        <OrderTicket
          account={account}
          address={address}
          marketAddress={marketAddress}
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
            marketAddress={marketAddress}
            market={market}
            onChange={bump}
          />
        </div>
      </motion.div>

      <motion.div {...rise(0.24, reduced)}>
        <Disclosure />
      </motion.div>

      <motion.div {...rise(0.32, reduced)}>
        <Keeper
          account={account}
          address={marketAddress}
          market={market}
          onChange={bump}
        />
      </motion.div>
    </Shell>
  );
}
