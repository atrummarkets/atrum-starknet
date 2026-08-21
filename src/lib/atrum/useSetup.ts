"use client";

/**
 * Is this browser ready to trade?
 *
 * Two facts, both read from the chain rather than remembered:
 *   1. the address has a viewing key on file — without it nothing private works
 *   2. it has a shielded balance to fund an order
 *
 * Kept out of localStorage on purpose. A "you're set up" flag would go stale the moment
 * someone switched wallet, cleared storage, or spent their balance elsewhere, and a market
 * that says you're ready when you are not is worse than one that checks.
 */
import { useCallback, useEffect, useState } from "react";
import { hash } from "starknet";
import { NET, POOL } from "./config";
import { provider } from "./wallet";

export type Setup = {
  enrolled: boolean | null;
  checking: boolean;
};

export function useSetup(address: string) {
  const [state, setState] = useState<Setup>({ enrolled: null, checking: false });

  const check = useCallback(async () => {
    if (!address) {
      setState({ enrolled: null, checking: false });
      return;
    }
    setState((s) => ({ ...s, checking: true }));
    try {
      const r = await provider().callContract({
        contractAddress: POOL[NET],
        entrypoint: "get_public_key",
        calldata: [address],
      });
      setState({ enrolled: BigInt(r[0]) !== 0n, checking: false });
    } catch {
      setState({ enrolled: null, checking: false });
    }
  }, [address]);

  useEffect(() => {
    void check();
  }, [check]);

  return { ...state, recheck: check };
}
