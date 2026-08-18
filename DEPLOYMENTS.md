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

Budget note: a STRK20 pool transaction is **~3.6 STRK** on mainnet, measured off real
receipts (median of four, 3.29–3.66). A plain contract call is ~0.25. The `DECLARE` cost is
the one figure not yet measured — it is dominated by CASM size, and this contract compiles
to 4,669 Sierra felts / 251 KB.

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
