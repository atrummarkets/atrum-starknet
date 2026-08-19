# Deployments

## Sepolia — live

The current market. Question and resolution source are stored on-chain and there is no
setter for either.

| | |
|---|---|
| **AtrumAuction** | [`0x04c9fc08717d94c8d967d4cae2c1cfa7713daf5a45fb06bf900c970dd2dd7cf2`](https://sepolia.voyager.online/contract/0x04c9fc08717d94c8d967d4cae2c1cfa7713daf5a45fb06bf900c970dd2dd7cf2) |
| Class hash | `0x19b710b57271acc96786ca052509111882c012a5e4c4fee597c3f0d8b5b1a96` |
| STRK20 pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Collateral | STRK — `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Pool fee | 2 STRK per private operation (measured from `get_fee_amount`) |

**Question:** *Will STRK close below 0.0225 USD on 24 Aug 2026 00:00 UTC?*
**Resolution source:** *Pragma STRK/USD median on Starknet mainnet at the stated time.*
**settle_after:** `1787529600` — 24 Aug 2026 00:00 UTC. No resolution before this.
**resolve_deadline:** `1787659200` — 25 Aug 2026 12:00 UTC. After this anyone may call
`force_refund` and every holder is refunded exactly what they paid.

The question is deliberate: nobody at a Starknet hackathon can take the bearish side of it
in public. That is the product, demonstrated rather than described.

### Superseded Sepolia deploys

Kept so the history is legible rather than tidy. Each was replaced because the contract
gained something, not because it failed.

| Address | Why superseded |
|---|---|
| `0x0696e6e0…4924` | single-batch — no positions, no early exit |
| `0x0440ac9d…5e37` | multi-batch, but no committed question — an auction, not a market |

Two of those were deployed from a **stale release artifact**: `scarb build` writes the `dev`
profile while `sncast declare` reads `release`, so a plain build declares code you are not
looking at. Both times it surfaced as an unrelated runtime error. `scripts/deploy.sh` now
forces `--profile release` and prints the constructor the artifact actually has before
touching a network.

## Mainnet — not yet

The class hash above is Sepolia's. Mainnet needs its own `DECLARE`, because a class is
registered per network.

### Measured mainnet costs

All figures measured, not estimated. Pool transactions come from real mainnet receipts
(median of four, 3.29–3.66 STRK). Declare costs are measured on Sepolia and converted at
mainnet gas prices — gas *amounts* are identical across networks, only prices differ, and
the l2 price happens to be the same on both.

| | mainnet |
|---|---|
| STRK20 pool transaction | **3.6 STRK** |
| Plain contract call | ~0.25 STRK |
| `DEPLOY` an instance | ~0.5 STRK |
| `DECLARE` — single-batch, 1% grid (4,669 felts) | 24.97 STRK |
| `DECLARE` — multi-batch, 5% grid (5,813 felts) | **31.93 STRK** |

Early exit — the thing that makes this a market rather than a pool — costs about 7 STRK of
declare. It is worth it.

A full mainnet run is roughly **48 STRK**: declare, deploy, shield, two submits, a
withdrawal, and the cheap direct calls in between.

### What did NOT work

A `Felt252Dict` price ladder cut clearing gas 3.9x (145M → 37M for four orders) by reading
each order twice instead of once per price rung. It was reverted: the dict's squashing
machinery made the class **31% larger**, and since `DECLARE` is around 60% of a deployment
budget, size beats runtime gas here. The 5% grid gets most of the gas win with none of the
size cost, and buckets more orders per rung, which is better for privacy too.

## Reproducing a deploy

```bash
sncast account create --network sepolia --name atrum_sepolia   # then fund from the faucet
sncast account deploy  --network sepolia --name atrum_sepolia
scarb build
sncast declare --network sepolia --contract-name AtrumAuction
sncast deploy  --network sepolia --class-hash <CLASS> \
  --arguments "<pool>, <token>, <owner>"
```

`DECLARE` registers the class once per network. `DEPLOY` instantiates a market against it
and is cheap — which is why one contract per market is the right shape here, rather than
threading a `market_id` through every storage key.
