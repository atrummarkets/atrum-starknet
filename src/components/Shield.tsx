"use client";

/**
 * Shielding — moving public STRK into the pool.
 *
 * THIS IS THE FIRST STEP AND IT IS NOT OPTIONAL. A deposit is the only STRK20 action that
 * works without an existing pool balance, and it is what registers you: there is no explicit
 * `register` action in the wallet API, only deposit / withdraw / transfer / invoke. Trying to
 * place an order before shielding fails with NOT_REGISTERED, which reads like a permission
 * problem and is really a "you have not arrived yet" problem.
 *
 * So this panel sits ABOVE the order ticket and says what it is for. Ordering is the
 * explanation; a tooltip would not be.
 */
import { useState } from "react";
import type { WalletAccountV6 } from "starknet";
import { STRK, fmtStrk } from "@/lib/atrum/config";
import { shieldActions, submit } from "@/lib/atrum/wallet";

export function Shield({
  account,
  poolFee,
  onDone,
}: {
  account: WalletAccountV6 | null;
  poolFee: bigint;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err" | ""; t: string }>({ k: "", t: "" });

  let wei = 0n;
  try {
    wei = BigInt(Math.round(parseFloat(amount || "0") * 1e18));
  } catch {
    wei = 0n;
  }

  async function shield() {
    if (!account || wei <= 0n) return;
    setBusy(true);
    setMsg({ k: "", t: "" });
    try {
      const tx = await submit(account, shieldActions(wei));
      setMsg({
        k: "ok",
        t: `Shielded. ${tx.slice(0, 12)}… — wait about ten blocks before ordering.`,
      });
      onDone();
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : "Shield failed." });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reading the shielded balance is a WALLET call and it prompts the user for consent to
   * share private balances. So it is a button they press, never something this page does on
   * mount — an app that silently asks for balance access on load has already misunderstood
   * what it is building.
   */
  async function checkBalance() {
    if (!account) return;
    setBusy(true);
    try {
      const rows = await account.strk20Balances([STRK]);
      const row = rows.find((r) => BigInt(r.token) === BigInt(STRK));
      setBalance(row ? BigInt(row.balance) : 0n);
      setMsg({ k: "", t: "" });
    } catch (e) {
      setMsg({ k: "err", t: e instanceof Error ? e.message : "Could not read balance." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <p className="panel-label">Step one · shield STRK into the pool</p>

      <p className="notice">
        Orders are funded from a shielded balance, so this comes first. Depositing is also
        what registers you with the pool — placing an order beforehand fails with{" "}
        <code>NOT_REGISTERED</code>.
      </p>

      <div className="field" style={{ marginTop: "1rem" }}>
        <label>Amount to shield</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
        <span className="hint">
          Public STRK moves into the pool. The deposit itself is visible on-chain — that is
          unavoidable and it is why you shield ahead of time rather than right before a trade.
        </span>
      </div>

      <div className="btn-row">
        <button className="btn" disabled={!account || busy || wei <= 0n} onClick={() => void shield()}>
          {busy ? "Working…" : "Shield"}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={!account || busy} onClick={() => void checkBalance()}>
          Check shielded balance
        </button>
      </div>

      {balance !== null && (
        <dl style={{ margin: "1rem 0 0" }}>
          <div className="stat-row">
            <dt>Shielded balance</dt>
            <dd className="hi">{fmtStrk(balance)} STRK</dd>
          </div>
          <div className="stat-row">
            <dt>Pool fee per operation</dt>
            <dd>{fmtStrk(poolFee)} STRK</dd>
          </div>
        </dl>
      )}

      <p className="notice notice-warn">
        <b>Two wallet prompts.</b> The ERC-20 approval has to land on-chain before the private
        deposit, so your wallet asks twice. The second is not a duplicate — rejecting it
        leaves the approval spent and nothing shielded.
      </p>

      <p className="notice">
        New notes need roughly <b>ten blocks</b> to mature before they can be spent. Shield,
        wait a minute, then order.
      </p>

      {msg.t && (
        <p className="msg-line" data-kind={msg.k}>
          {msg.t}
        </p>
      )}
    </div>
  );
}
