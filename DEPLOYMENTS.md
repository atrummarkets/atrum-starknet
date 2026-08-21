# Deployments

> **The live Sepolia factory predates the on-chain reveal window and needs replacing.**
>
> `clear` used to be callable the instant a round closed, and what stopped that from
> excluding bidders who had not revealed yet was a timer inside the keeper process --
> unverifiable from outside, unenforceable against a hostile keeper, and lost on every
> restart. The contract now stamps the close time and refuses to clear until each market's
> own `reveal_window` has elapsed.
>
> That changed the auction class hash, and a factory's auction class is immutable by design,
> so it means a new factory rather than an upgrade. The markets below keep working under the
> old rules; the current keeper deliberately refuses to advance them, because for a market
> with no on-chain close time it cannot prove it waited. Recreate them through the new
> factory before relying on any of this.

## Sepolia — live

### Factory

Markets are created through it and read from its on-chain index, so a market a stranger
deploys appears in the app without anyone shipping a build.

| | |
|---|---|
| **AtrumFactory** | [`0x0288f9a6edadaa43b25b2717e1acf47c1bb2b5144a0bfd8d1ff35db659dcb2cc`](https://sepolia.voyager.online/contract/0x0288f9a6edadaa43b25b2717e1acf47c1bb2b5144a0bfd8d1ff35db659dcb2cc) |
| Factory class | `0x670c7e322b0378425331907507d56d9dd5c850f82aeae323cb38bc2164b7b9a` |
| **Auction class** — every market runs this | `0x19b710b57271acc96786ca052509111882c012a5e4c4fee597c3f0d8b5b1a96` |
| STRK20 pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Collateral | STRK — `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Pool fee | 2 STRK per private operation (measured from `get_fee_amount`) |

The auction class hash is set in the factory's constructor and there is **no setter**. That
is the whole security argument for trusting a market you did not deploy: every market from
this factory runs the same code, so reading one tells you something about the next. A
repointable factory could start producing drainers and its history would not warn you.

### Markets, created through the factory

| # | Question | Address |
|---|---|---|
| 0 | Will STRK close below 0.0225 USD on 24 Aug 2026 00:00 UTC? | [`0x18f4b0ba…8922`](https://sepolia.voyager.online/contract/0x18f4b0baf66f0014c27113b08b3e452010e5947d22d8c1281e37b28cbfa8922) |
| 1 | Will ETH close above 2000 USD on 26 Aug 2026 00:00 UTC? | [`0x2fe0781f…4a5`](https://sepolia.voyager.online/contract/0x2fe0781f4935c30f9f5fea64c25fce2b5fe810349be4038daeaa61bc6f6c4a5) |
| 2 | Will Starknet daily transactions exceed 500k on 28 Aug 2026? | [`0x10fc953a…040`](https://sepolia.voyager.online/contract/0x10fc953a3e37fbc33961a6b154c6aaa1d4f1af093f1774896041e7ba4330040) |

Creation is permissionless and the creator becomes their own market's resolver. What stops
that being a rug: the question and resolution source are fixed at creation, the outcome can
only be published inside a stated window, and once that window passes **anyone** can refund
every holder. A creator can be wrong. They cannot steal, and they cannot touch another
market.

### Superseded

Kept so the history is legible rather than tidy.

| Address | Why |
|---|---|
| `0x0696e6e0…4924` | single-batch — no positions, no early exit |
| `0x0440ac9d…5e37` | multi-batch, no committed question — an auction, not a market |
| `0x04c9fc08…7cf2` | had the question, but deployed by hand rather than through the factory |

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
