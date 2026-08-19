"use client";

/**
 * Wallet connection.
 *
 * Capability is checked by VERSION QUERY before anything is requested. Probing a data
 * method like `strk20Balances` would work as feature detection and would also make the
 * wallet ask the user to share private balances — demanding a privacy decision from someone
 * who has not asked for anything yet.
 */
import { useEffect, useState } from "react";
import { createStore } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard-v6/features";
import type { WalletAccountV6 } from "starknet";
import { connect, supportsStrk20 } from "@/lib/atrum/wallet";
import { NET } from "@/lib/atrum/config";

type Found = { wallet: WalletWithStarknetFeatures; ok: boolean };

export function Connect({
  account,
  onConnect,
}: {
  account: WalletAccountV6 | null;
  onConnect: (a: WalletAccountV6 | null, addr: string) => void;
}) {
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState("");

  useEffect(() => {
    const store = createStore({
      // Stops MetaMask and other EVM injectors appearing in a Starknet picker.
      eip1193Adapters: [],
    });
    const scan = async () => {
      const wallets = store.getWallets() as unknown as WalletWithStarknetFeatures[];
      const checked = await Promise.all(
        wallets.map(async (w) => ({ wallet: w, ok: await supportsStrk20(w) })),
      );
      setFound(checked);
    };
    void scan();
    // Wallets register asynchronously as their extensions inject, so a one-shot scan at
    // mount misses any that arrive a beat later. `subscribe` is the store's own signal for
    // that, and it is the difference between "no wallet found" and "you were too early".
    const unsub = store.subscribe(() => void scan());
    return () => unsub?.();
  }, []);

  async function pick(w: WalletWithStarknetFeatures) {
    setErr(null);
    setBusy(w.name);
    try {
      const a = await connect(w);
      setAddr(a.address);
      onConnect(a, a.address);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(null);
    }
  }

  if (account) {
    return (
      <div className="panel panel-tight">
        <p className="panel-label">Connected · {NET}</p>
        <div className="meta-row">
          <span>
            <b>{addr.slice(0, 8)}…{addr.slice(-6)}</b>
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setAddr("");
              onConnect(null, "");
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  const supported = found.filter((f) => f.ok);
  const unsupported = found.filter((f) => !f.ok);

  return (
    <div className="panel">
      <p className="panel-label">Connect a wallet</p>

      {found.length === 0 && (
        <p className="notice">
          No Starknet wallet detected. This market needs a privacy-enabled wallet —{" "}
          <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
            Ready
          </a>{" "}
          is the one that supports STRK20 today.
        </p>
      )}

      <div className="btn-row">
        {supported.map((f) => (
          <button
            key={f.wallet.name}
            className="btn"
            disabled={busy !== null}
            onClick={() => void pick(f.wallet)}
          >
            {busy === f.wallet.name ? "Connecting…" : f.wallet.name}
          </button>
        ))}
      </div>

      {unsupported.length > 0 && (
        <p className="notice">
          Found {unsupported.map((f) => f.wallet.name).join(", ")}, but{" "}
          {unsupported.length === 1 ? "it does not" : "they do not"} support the STRK20 wallet
          API yet. Sealed orders need the wallet to hold the viewing key and do the proving —
          this app never sees either.
        </p>
      )}

      {err && (
        <p className="msg-line" data-kind="err">
          {err}
        </p>
      )}
    </div>
  );
}
