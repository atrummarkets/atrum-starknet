"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Entrance timing.
 *
 * The page arrives in the order you would read it, with enough delay between
 * lines to feel deliberate rather than staggered for the sake of it. Under
 * reduced-motion every element resolves instantly at its final position — the
 * content is never withheld, only the movement is.
 */
const rise = (delay: number, reduced: boolean | null) =>
  reduced
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
      };

export default function Home() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOk(false);
        setMsg(data.error ?? "That did not go through. Try again.");
      } else {
        setOk(true);
        setMsg(
          data.position
            ? `You're in — number ${data.position}. We'll mail you when it opens.`
            : "You're in. We'll mail you when it opens."
        );
        setEmail("");
      }
    } catch {
      setOk(false);
      setMsg("That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const reduced = useReducedMotion();

  return (
    <>
      {/* Atmosphere sits behind everything and is inert to the pointer. */}
      <div className="atmos" aria-hidden="true">
        <div className="backdrop" />
        <div className="fog fog-a" />
        <div className="fog fog-b" />
      </div>

      <div className="shell">
        <motion.header {...rise(0, reduced)}>
          <span className="wordmark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-chrome.png" alt="Atrum" />
          </span>
          <span className="chain">Starknet</span>
        </motion.header>

      <main>
        <motion.p className="eyebrow" {...rise(0.1, reduced)}>Coming soon</motion.p>

        <motion.h1 {...rise(0.18, reduced)}>
          Nobody sees your order until it&nbsp;<em>already counts</em>.
        </motion.h1>

        <motion.p className="lead" {...rise(0.3, reduced)}>
          A prediction market that clears in sealed batches. Orders are unreadable until the
          batch closes, everything settles at one shared price, and you can sell a position
          before the event resolves.
        </motion.p>

        <motion.ul className="props" {...rise(0.42, reduced)}>
          <li>
            <span className="n">01</span>
            <span>
              <b>Sealed until binding.</b> Your side and your price stay hidden while the
              batch is open — so there is no moment where someone can see your order and
              still trade ahead of it.
            </span>
          </li>
          <li>
            <span className="n">02</span>
            <span>
              <b>One price for everyone.</b> Each batch clears where demand meets supply. No
              queue, no advantage in being fast.
            </span>
          </li>
          <li>
            <span className="n">03</span>
            <span>
              <b>Leave when you want.</b> Buy the other side in a later batch and cash out
              immediately — no counterparty, no waiting for the result. Being right early is
              worth something.
            </span>
          </li>
        </motion.ul>

        <motion.div className="join" {...rise(0.54, reduced)}>
          <form onSubmit={submit}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email address"
              autoComplete="email"
            />
            <button type="submit" disabled={busy}>
              {busy ? "Joining…" : "Join the waitlist"}
            </button>
          </form>
          <p className="msg" data-ok={ok} role="status" aria-live="polite">
            {msg}
          </p>
        </motion.div>
      </main>

      <motion.footer {...rise(0.66, reduced)}>
        <span>Built on Starknet</span>
        <span>
          <a href="https://x.com/AtrumMarkets" target="_blank" rel="noreferrer">
            @AtrumMarkets
          </a>
        </span>
      </motion.footer>
      </div>
    </>
  );
}
