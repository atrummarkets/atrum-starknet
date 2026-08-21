"use client";

/**
 * Setup — the one-time things, in one place.
 *
 * These used to live as permanent panels on every market page, which made a market read as
 * a configuration screen. They are one-time, so they belong on a page you visit once and
 * then never again.
 *
 * The order is the dependency order, and each step says what it unlocks rather than what it
 * is. Nobody cares what a viewing key is; they care that nothing works without one.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { WalletAccountV6 } from "starknet";
import { Shell } from "@/components/Shell";
import { Connect } from "@/components/Connect";
import { STRK, fmtStrk, POOL_FEE_FALLBACK, NET } from "@/lib/atrum/config";
import { readPoolFee, shieldActions, submit } from "@/lib/atrum/wallet";
import { useSetup } from "@/lib/atrum/useSetup";
import { computeHolder, exportBackup, holderSecret } from "@/lib/atrum/orders";

const APP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_APP === "1";

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="panel" style={done ? { opacity: 0.72 } : undefined}>
      <p className="panel-label" style={{ color: done ? "var(--strk-orange)" : undefined }}>
        {done ? "✓" : n} · {title}
      </p>
      {children}
    </div>
  );
}

export default function Setup() {
  const [account, setAccount] = useState<WalletAccountV6 | null>(null);
  const [address, setAddress] = useState("");
  const { enrolled, checking, recheck } = useSetup(address);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [poolFee, setPoolFee] = useState<bigint>(POOL_FEE_FALLBACK[NET]);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });

  useEffect(() => {
    void readPoolFee().then(setPoolFee).catch(() => {});
  }, []);

  let wei = 0n;
  try {
    wei = BigInt(Math.round(parseFloat(amount || "0") * 1e18));
  } catch {
    wei = 0n;
  }

  async function checkBalance() {
    if (!account) return;
    setBusy(true);
    try {
      const rows = await account.strk20Balances([STRK]);
      const row = rows.find((r) => BigInt(r.token) === BigInt(STRK));
      setBalance(row ? BigInt(row.balance) : 0n);
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : "Could not read balance." });
    } finally {
      setBusy(false);
    }
  }

  async function shield() {
    if (!account || wei <= 0n) return;
    setBusy(true);
    setMsg({ k: "", t: "" });
    try {
      const tx = await submit(account, shieldActions(wei));
      setMsg({ k: "ok", t: `Shielded. Give it about a minute, then check your balance.` });
      void tx;
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : "Shield failed." });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `atrum-secrets-${NET}.json`;
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

  const ready = Boolean(address) && enrolled === true && (balance ?? 0n) > 0n;

  return (
    <Shell>
      <div className="section-head">
        <h2>Get set up</h2>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-3)" }}>
          one time, then never again
        </span>
      </div>

      <Step n={1} title="Connect a wallet" done={Boolean(address)}>
        <Connect
          account={account}
          onConnect={(a, addr) => {
            setAccount(a);
            setAddress(addr);
          }}
        />
      </Step>

      <Step n={2} title="Join the privacy pool" done={enrolled === true}>
        {!address && <p className="notice">Connect first.</p>}

        {address && enrolled === true && (
          <p className="notice">
            You&apos;re in. Your orders can be encrypted to you, and nothing about them is
            readable by anyone else.
          </p>
        )}

        {address && enrolled === false && (
          <>
            <p className="notice notice-warn">
              Nothing private works until you join — not an order, not even a deposit. It is
              one transaction, once, ever.
            </p>
            <p className="notice">
              <b>Your wallet does this, not us.</b> Turn on the privacy feature in Ready and it
              joins you on first use. We deliberately cannot do it for you: the key is derived
              from a signature, and one derived even slightly differently joins{" "}
              <em>successfully</em> and then silently fails to decrypt anything ever sent to
              you.
            </p>
            <div className="btn-row" style={{ marginTop: "0.9rem" }}>
              <button className="btn" onClick={() => void recheck()} disabled={checking}>
                {checking ? "Checking…" : "I've done it — check again"}
              </button>
              <a
                className="btn btn-ghost btn-sm"
                href="https://strk20.starknet.io/app"
                target="_blank"
                rel="noreferrer"
              >
                Or join here
              </a>
            </div>
          </>
        )}
      </Step>

      <Step n={3} title="Move some STRK somewhere private" done={(balance ?? 0n) > 0n}>
        {enrolled !== true ? (
          <p className="notice">Join the pool first.</p>
        ) : (
          <>
            <p className="notice">
              Orders are paid for from a private balance. Moving money in is public — that is
              unavoidable and it is exactly why you do it now, separately, rather than at the
              moment you place a bet. Nothing links the two.
            </p>

            <div className="field" style={{ marginTop: "1rem" }}>
              <label>How much STRK</label>
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
              <span className="hint">
                Each bet also costs a {fmtStrk(poolFee)} STRK network fee, so bring a little
                more than you plan to stake.
              </span>
            </div>

            <div className="btn-row">
              <button className="btn" disabled={busy || wei <= 0n} onClick={() => void shield()}>
                {busy ? "Working…" : `Move ${amount || "0"} STRK`}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void checkBalance()}>
                Check private balance
              </button>
            </div>

            {balance !== null && (
              <dl style={{ margin: "1rem 0 0" }}>
                <div className="stat-row">
                  <dt>Private balance</dt>
                  <dd className="hi">{fmtStrk(balance)} STRK</dd>
                </div>
              </dl>
            )}

            <p className="notice notice-warn">
              <b>Two wallet prompts.</b> An approval, then the deposit. The second is not a
              duplicate — rejecting it leaves the approval spent and nothing moved.
            </p>
            <p className="notice">
              New funds take about <b>a minute</b> to become spendable.
            </p>
          </>
        )}
      </Step>

      <Step n={4} title="Save your keys" done={false}>
        <p className="notice notice-warn">
          Your bets are tied to a secret held <b>only in this browser</b>. There is no account
          and no server copy — that is what makes them yours alone, and it means losing this
          browser loses access to them. Nobody can recover it, including us.
        </p>
        <div className="btn-row" style={{ marginTop: "0.9rem" }}>
          <button className="btn" onClick={download}>
            Download my keys
          </button>
        </div>
        {address && (
          <p className="notice" style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem" }}>
            your pseudonym {("0x" + computeHolder(holderSecret()).toString(16)).slice(0, 18)}…
            <br />
            This, not your address, is what the market sees.
          </p>
        )}
      </Step>

      {ready && (
        <div className="exit">
          <span className="exit-head">You&apos;re ready</span>
          <p>Everything above is one-time. You will not see this page again unless you need it.</p>
          <div className="btn-row">
            <Link className="btn" href="/app">
              Find a market
            </Link>
          </div>
        </div>
      )}

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </Shell>
  );
}
