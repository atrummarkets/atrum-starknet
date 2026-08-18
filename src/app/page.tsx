"use client";

import { useState } from "react";

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

  return (
    <div className="shell">
      <header>
        <span className="wordmark">Atrum</span>
        <span className="chain">Starknet</span>
      </header>

      <main>
        <p className="eyebrow">Coming soon</p>

        <h1>
          Nobody sees your order until it&nbsp;<em>already counts</em>.
        </h1>

        <p className="lead">
          A prediction market that clears in sealed batches. Orders are unreadable until the
          batch closes, everything settles at one shared price, and you can sell a position
          before the event resolves.
        </p>

        <ul className="props">
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
              <b>Leave when you want.</b> Positions are tradeable before the event settles.
              Being right early is worth something.
            </span>
          </li>
        </ul>

        <div className="join">
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
        </div>
      </main>

      <footer>
        <span>Built on Starknet</span>
        <span>
          <a href="https://x.com/AtrumMarkets" target="_blank" rel="noreferrer">
            @AtrumMarkets
          </a>
        </span>
      </footer>
    </div>
  );
}
