# Deployments

## Sepolia — live

| | |
|---|---|
| **AtrumAuction** | [`0x0696e6e0c408707b2782e6e54571a2f8e3a69ce4f3b8b09ca52c8f13bd624924`](https://sepolia.voyager.online/contract/0x0696e6e0c408707b2782e6e54571a2f8e3a69ce4f3b8b09ca52c8f13bd624924) |
| Class hash | `0x29562faaa55f236786f7d4a958f07949db723ea5c09af11d990b1fdf5447c12` |
| STRK20 pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Collateral | STRK — `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Deploy tx | [`0x00afc8071028d8c05c7f7b8c13f013955c13f828edf63d0e3bee31e296ed4fb7`](https://sepolia.voyager.online/tx/0x00afc8071028d8c05c7f7b8c13f013955c13f828edf63d0e3bee31e296ed4fb7) |

Verified on deploy: `get_phase` → `Phase::Open`, `get_batch` → 0, `get_order_count(0)` → 0.

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
