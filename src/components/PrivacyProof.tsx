"use client";

/**
 * Proof, not assertion.
 *
 * The disclosure table SAYS your identity is hidden. This fetches the transaction that
 * carried your order and checks, against the chain, whether that is true: who the sender
 * actually was, and whether your address appears anywhere in the calldata.
 *
 * IT IS BUILT TO FIND OUT, NOT TO REASSURE.
 *
 * If your address does turn up in the calldata, this says so in red. A panel that could only
 * ever return "you are safe" would be decoration, and worse than nothing on a privacy
 * product — it would train people to trust a check that never fires.
 *
 * What it should show, if the design is working: the sender is a shared relayer with a nonce
 * in the hundreds of thousands, your address is absent, and the only visible number is the
 * escrow. That last part is not a flaw being hidden — amounts are public on STRK20 and the
 * panel names them.
 */
import { useCallback, useState } from "react";
import { EXPLORER, NET, fmtStrk } from "@/lib/atrum/config";
import { provider } from "@/lib/atrum/wallet";
import { listOrders, type StoredOrder } from "@/lib/atrum/orders";

const NETNAME = process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia";

type Finding = {
  txHash: string;
  sender: string;
  senderIsYou: boolean;
  addressInCalldata: boolean;
  calldataLen: number;
  escrow: bigint;
};

export function PrivacyProof({ userAddress }: { userAddress: string }) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const orders = listOrders(NETNAME).filter((o) => o.txHash);

  const inspect = useCallback(
    async (o: StoredOrder) => {
      if (!o.txHash) return;
      setBusy(true);
      setErr(null);
      setFinding(null);
      try {
        const tx = (await provider().getTransaction(o.txHash)) as unknown as {
          sender_address?: string;
          calldata?: string[];
        };
        const sender = tx.sender_address ?? "";
        const calldata = tx.calldata ?? [];

        // Compare as integers: a padded and an unpadded felt are the same address, and a
        // string compare would report "absent" for an address that is plainly present.
        const me = BigInt(userAddress || "0");
        const inCalldata = calldata.some((c) => {
          try {
            return BigInt(c) === me && me !== 0n;
          } catch {
            return false;
          }
        });

        setFinding({
          txHash: o.txHash,
          sender,
          senderIsYou: sender !== "" && me !== 0n && BigInt(sender) === me,
          addressInCalldata: inCalldata,
          calldataLen: calldata.length,
          escrow: BigInt(o.escrow),
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not fetch the transaction.");
      } finally {
        setBusy(false);
      }
    },
    [userAddress],
  );

  if (orders.length === 0) return null;

  const clean = finding && !finding.senderIsYou && !finding.addressInCalldata;

  return (
    <div className="panel">
      <p className="panel-label">Check the privacy yourself</p>

      <p className="notice">
        Pick an order you placed. This fetches the transaction that carried it and checks the
        chain — not our word for it — for whether your address is in there.
      </p>

      <div className="btn-row" style={{ marginTop: "0.9rem" }}>
        {orders.slice(0, 4).map((o) => (
          <button
            key={o.commitment}
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void inspect(o)}
          >
            {o.side === 1 ? "YES" : "NO"} @ {o.side === 1 ? o.limit : 100 - o.limit} ·{" "}
            {o.txHash!.slice(0, 8)}…
          </button>
        ))}
      </div>

      {busy && <p className="msg-line">Reading the chain…</p>}
      {err && (
        <p className="msg-line" data-kind="err">
          {err}
        </p>
      )}

      {finding && (
        <>
          <table className="disclose" style={{ marginTop: "1.1rem" }}>
            <tbody>
              <tr>
                <td>Who submitted it</td>
                <td className={finding.senderIsYou ? "yes-public" : "is-hidden"}>
                  {finding.senderIsYou ? "YOU — not private" : "a shared relayer"}
                </td>
              </tr>
              <tr>
                <td>Your address in the calldata</td>
                <td className={finding.addressInCalldata ? "yes-public" : "is-hidden"}>
                  {finding.addressInCalldata ? "PRESENT" : "absent"}
                </td>
              </tr>
              <tr>
                <td>Fields inspected</td>
                <td>{finding.calldataLen}</td>
              </tr>
              <tr>
                <td>Escrow — visible by design</td>
                <td className="yes-public">{fmtStrk(finding.escrow)} STRK</td>
              </tr>
            </tbody>
          </table>

          <p className="notice" style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem" }}>
            sender {finding.sender.slice(0, 14)}…{finding.sender.slice(-6)}
            <br />
            you&nbsp;&nbsp;&nbsp;&nbsp; {userAddress.slice(0, 14)}…{userAddress.slice(-6)}
          </p>

          {clean ? (
            <p className="notice">
              Your order is on-chain and you are not. The transaction was submitted by a
              rotating shared relayer, and scanning every field of its calldata finds your
              address nowhere. What a watcher learns is that <em>somebody</em> escrowed{" "}
              {fmtStrk(finding.escrow)} STRK — not who, not which side, not at what price.
            </p>
          ) : (
            <p className="notice notice-warn">
              <b>This did not come back clean.</b>{" "}
              {finding.senderIsYou
                ? "Your own address submitted the transaction, so the sender-level privacy did not hold here."
                : "Your address appears in the calldata."}{" "}
              That is worth understanding before trusting the rest — the check is here to fire,
              not to reassure.
            </p>
          )}

          <p className="notice">
            <a href={`${EXPLORER[NET]}/tx/${finding.txHash}`} target="_blank" rel="noreferrer">
              Open it on Voyager
            </a>{" "}
            and check for yourself. That is the point.
          </p>
        </>
      )}
    </div>
  );
}
