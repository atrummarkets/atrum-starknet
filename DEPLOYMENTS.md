# Deployments

## Sepolia — live

### Factory

Markets are created through it and read from its on-chain index, so a market a stranger
deploys appears in the app without anyone shipping a build.

| | |
|---|---|
| **AtrumFactory** | [`0x007159d8d4160c5e84f561cb11addad3d376515344b622bb35b9ef24f7229197`](https://sepolia.voyager.online/contract/0x007159d8d4160c5e84f561cb11addad3d376515344b622bb35b9ef24f7229197) |
| Factory class | `0x71274694fe433ca39679184918ddf9991ad3dbbe1f17d905a3938c4d836484c` |
| **Auction class** — every market runs this | `0x7722d94883f0ed7fd1d199d125770b880a44c3e8808c144b5a191465ea59c01` |
| STRK20 pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Collateral | STRK — `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Pool fee | 2 STRK per private operation (measured from `get_fee_amount`) |

The auction class hash is set in the factory's constructor and there is **no setter**. That
is the whole security argument for trusting a market you did not deploy: every market from
this factory runs the same code, so reading one tells you something about the next. A
repointable factory could start producing drainers and its history would not warn you.

### Markets, created through the factory

`reveal window` is how long after a round closes bidders have to reveal, and `clear` will not
be accepted before it elapses. It is fixed at creation with no setter, so it is a promise a
trader can check with `get_reveal_window()` **before** committing money rather than a keeper's
good manners.

| # | Question | Reveal window | Address |
|---|---|---|---|
| 0 | Will ETH close above 3000 USD on 31 Aug 2026 00:00 UTC? | 60 min | [`0x42194785…7bee`](https://sepolia.voyager.online/contract/0x42194785e7c3aab9a72016051e36b621df7cddd92a62834cd7ef8d3f6737bee) |
| 1 | Will STRK close above 0.15 USD on 28 Aug 2026 00:00 UTC? | 60 min | [`0x5a741c51…3bef`](https://sepolia.voyager.online/contract/0x5a741c51e1ae6f8bb50c0ab81d326d418c289023ab2fdbc2a57527af23e3bef) |
| 2 | Will Starknet daily transactions exceed 1M on 24 Aug 2026? | 5 min | [`0x510920c9…4c08`](https://sepolia.voyager.online/contract/0x510920c9b934a03f2bf0bb2f4622f3d27cbaa9ec42e06a4d65ef9111ce34c08) |

Market 2 exists to be demonstrated in front of someone: five minutes is long enough to reveal
without hurrying and short enough to watch a whole round finish. Sixty minutes is what a real
market should use, because revealing needs the bettor's own secret and so cannot be automated
on their behalf.

Creation is permissionless and the creator becomes their own market's resolver. What stops
that being a rug: the question and resolution source are fixed at creation, the outcome can
only be published inside a stated window, and once that window passes **anyone** can refund
every holder. A creator can be wrong. They cannot steal, and they cannot touch another
market.

### The keeper

| | |
|---|---|
| Account | [`0x035277a50c91a293cd5bb9baac8686bb877ffdf4a8b27e1880dc12d46ce418b0`](https://sepolia.voyager.online/contract/0x035277a50c91a293cd5bb9baac8686bb877ffdf4a8b27e1880dc12d46ce418b0) |
| Funded | 30 STRK, gas only |
| Runs on | GitHub Actions, every 5 minutes — [`.github/workflows/keeper.yml`](.github/workflows/keeper.yml) |

**Deliberately not the deploying account.** That one is the resolver of these three markets,
and a keeper has no business holding the power to decide an outcome. This account holds gas
and nothing else: it is not an owner or resolver anywhere, holds no collateral, and every call
it makes is one any stranger could make. A stolen keeper key advances rounds, which is public
anyway.

It holds no state, so a missed run costs a round nothing but time, and running a second keeper
needs no coordination with the first.

### Superseded

Kept so the history is legible rather than tidy.

#### Factory `0x0288f9a6…b2cc` — retired 21 Aug 2026

Its auction class predates the on-chain reveal window. `clear` was callable the instant a
round closed, and the only thing standing between that and silently dropping every
unrevealed bet was a timer inside the keeper process — unverifiable from outside,
unenforceable against a hostile keeper, and lost on every restart.

Replaced rather than upgraded because the factory's auction class hash is immutable, which is
the same property that makes trusting a market you did not deploy possible. Paying for it
here is the cost of that guarantee being real.

Its three markets still work under the old rules and positions in them remain claimable. The
current keeper refuses to advance them: with no on-chain close time it cannot prove it waited,
and doing it anyway would be precisely the unverifiable wait that was removed.

| | |
|---|---|
| Factory | `0x0288f9a6edadaa43b25b2717e1acf47c1bb2b5144a0bfd8d1ff35db659dcb2cc` |
| Auction class | `0x19b710b57271acc96786ca052509111882c012a5e4c4fee597c3f0d8b5b1a96` |
| Market 0 | `0x18f4b0baf66f0014c27113b08b3e452010e5947d22d8c1281e37b28cbfa8922` |
| Market 1 | `0x2fe0781f4935c30f9f5fea64c25fce2b5fe810349be4038daeaa61bc6f6c4a5` |
| Market 2 | `0x10fc953a3e37fbc33961a6b154c6aaa1d4f1af093f1774896041e7ba4330040` |

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
