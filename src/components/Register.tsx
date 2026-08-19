"use client";

/**
 * Step zero — registering a viewing key.
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
 * WHY WE LINK OUT INSTEAD OF DOING IT HERE
 *
 * Registration is a signature-derived key, not a plain transaction: sign `chainId:poolAddress`,
 * fold the signature with Poseidon, reduce into the curve order, publish the public half. The
 * derivation has to match the pool's expectation EXACTLY, because a key derived even slightly
 * differently registers successfully and then silently fails to decrypt anything ever sent to
 * you. Until we can test that against a real wallet, sending people to the official app is the
 * honest choice. Doing it ourselves is on the list, not in this build.
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
            This address has no viewing key yet, so nothing private will work — not an order,
            not even a shield. Every pool user registers <b>once</b>, on-chain, and the pool
            publishes the public half so notes can be encrypted to you.
          </p>
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <a
              className="btn"
              href="https://strk20.starknet.io/app"
              target="_blank"
              rel="noreferrer"
            >
              Register at strk20.starknet.io
            </a>
            <button className="btn btn-ghost btn-sm" onClick={() => void check()}>
              I have registered — re-check
            </button>
          </div>
          <p className="notice">
            We link out rather than doing this here for a reason worth stating: the viewing key
            is derived from a signature, and a key derived even slightly differently registers
            fine and then silently fails to decrypt anything ever sent to you. Until we can
            test our own derivation against a real wallet, the official app is the safer path.
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
