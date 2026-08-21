"use client";

/**
 * Step zero — a viewing key on file.
 *
 * Every pool user registers exactly once, on-chain, and NOTHING private works before that:
 * not a transfer, not a shield. The pool publishes your public viewing key so relayers can
 * encrypt notes to you; with no key there is nowhere to send them.
 *
 * WHY THIS PANEL EXISTS RATHER THAN A TRY-AND-SEE
 *
 * Unregistered, every action fails with NOT_REGISTERED, which reads as a permissions problem
 * and is really "you have not enrolled yet". The pool exposes `get_public_key(address)`, so
 * the state is READABLE — there is no excuse for making someone discover it by failing.
 *
 * WHOSE JOB IS THIS
 *
 * The wallet's. The STRK20 docs say the wallet registers the sender automatically on first
 * use, and the wallet API deliberately exposes no `register` method to dapps — there are
 * exactly three STRK20 methods (`strk20Balances`, `strk20PrepareInvoke`,
 * `strk20InvokeTransaction`) and none of them is registration.
 *
 * That is the right design. The viewing key is derived from a signature and must match the
 * pool's expectation exactly; a key derived even slightly differently registers SUCCESSFULLY
 * and then silently fails to decrypt anything ever sent to you. The wallet holds that
 * derivation, and a dapp reimplementing it would be a dapp that can strand your funds while
 * appearing to work.
 *
 * So this panel does not register. It reads the state and tells you where to do it: turn
 * privacy on in the wallet once, and the wallet handles the rest.
 */
import { useCallback, useEffect, useState } from "react";
import { hash } from "starknet";
import { POOL, NET } from "@/lib/atrum/config";
import { provider } from "@/lib/atrum/wallet";

type State = "unknown" | "checking" | "registered" | "unregistered";

export function Register({
  address,
  onStatus,
}: {
  address: string;
  onStatus: (registered: boolean) => void;
}) {
  const [state, setState] = useState<State>("unknown");

  const check = useCallback(async () => {
    if (!address) {
      setState("unknown");
      return;
    }
    setState("checking");
    try {
      const res = await provider().callContract({
        contractAddress: POOL[NET],
        entrypoint: "get_public_key",
        calldata: [address],
      });
      // A zero key means no key. Registration is the one thing you cannot fake by retrying.
      const registered = BigInt(res[0]) !== 0n;
      setState(registered ? "registered" : "unregistered");
      onStatus(registered);
    } catch {
      setState("unknown");
    }
  }, [address, onStatus]);

  useEffect(() => {
    void check();
  }, [check]);

  if (!address) return null;

  if (state === "registered") {
    return (
      <div className="panel panel-tight">
        <p className="panel-label" style={{ margin: 0, color: "var(--strk-orange)" }}>
          ✓ Registered with the pool
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="panel-label">Step zero · register with the pool</p>

      {state === "checking" && <p className="msg-line">Checking…</p>}

      {state === "unregistered" && (
        <>
          <p className="notice notice-warn">
            This address has no viewing key on file, so nothing private will work yet — not an
            order, not even a shield. Every pool user enrols <b>once</b>, and the pool then
            publishes the public half so notes can be encrypted to you.
          </p>

          <p className="notice">
            <b>Your wallet does this, not us.</b> Turn on the privacy / STRK20 feature in Ready
            once, and it enrols you the first time you use it. The wallet API exposes no
            registration call to apps on purpose: the key is derived from a signature, and a key
            derived even slightly differently enrols <em>successfully</em> and then silently
            fails to decrypt anything ever sent to you. That derivation belongs with whoever
            holds the key.
          </p>

          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button className="btn" onClick={() => void check()}>
              Re-check
            </button>
            <a
              className="btn btn-ghost btn-sm"
              href="https://strk20.starknet.io/app"
              target="_blank"
              rel="noreferrer"
            >
              Or enrol via strk20.starknet.io
            </a>
          </div>

          <p className="notice">
            Either route works and it is one-time per address. Once the key is on file this
            panel disappears and stays gone.
          </p>
        </>
      )}

      {state === "unknown" && (
        <p className="msg-line">
          Could not read registration state. The RPC may be rate-limiting.{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => void check()}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
