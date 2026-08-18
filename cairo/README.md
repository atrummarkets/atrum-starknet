# Atrum auction — Cairo

A sealed-bid, uniform-price batch auction, implemented as an STRK20 anonymizer contract.

## What it does

The pool calls `privacy_invoke` inside one atomic transaction:

```
withdraw from pool  ->  privacy_invoke  ->  credit open notes
```

Two operations use that path:

- **Submit** — the pool has already transferred collateral here, so the contract records
  `poseidon(side, limit, units, salt)` and returns an **empty** deposit span. Returning no
  deposit instructions is what makes the pool leave the tokens behind — that is the whole
  escrow mechanism.
- **Claim** — the contract re-derives the commitment from the preimage, so only the holder
  can claim, then approves the pool to pull the payout and names the open note to credit.

Reveal, clear and resolve move no tokens, so they are ordinary external calls.

## Price model

Prices are whole percent, `1..99`, read as the probability of YES.

| | escrow |
|---|---|
| Buy `u` units at limit `p` | `u * p` |
| Sell `u` units at limit `p` | `u * (100 - p)` |

A matched pair funds exactly `100` per unit between them, so the winner is paid `100` per
unit and nothing is created or destroyed. That is the conditional-token identity — one
collateral unit is one YES plus one NO — expressed in escrow rather than in tokens.

## Clearing

The clearing price maximises matched volume. Where several prices match the same volume —
which is the common case, not the exception — the **midpoint of the crossing range** wins.

That rule is load-bearing. With buyers at 70 and 60 and sellers at 50 and 65, every price
from 50 to 70 matches exactly one unit. Taking the lowest hands the whole 20-point spread
to the buyer on every trade; taking the highest hands it to the seller. Either is a
standing bias a participant can farm once they notice it.

It must also be **fully deterministic**: `clear()` is permissionless, so two honest callers
have to reach the same answer or the contract cannot tell which is right.

Allocation gives **strict price priority**, and pro-rates **only** at the clearing price.
There is no time priority anywhere — order arrival is visible on-chain, and using it to
allocate would reinstate exactly the speed advantage that clearing in a sealed batch exists
to remove. Pro-rata rounds down and the dust stays in escrow, so allocation can never
exceed matched volume.

## One contract per market

Deliberate, not a shortcut. Starknet separates `DECLARE` (register the class, once) from
`DEPLOY` (instantiate), so a new market is a cheap deploy against a class hash that already
exists. Each market then holds its own escrow, which means a bug in one cannot reach
another market's collateral. A factory that deploys and indexes instances is the natural
next step.

## Build and test

```bash
scarb build
snforge test
```

Requires `scarb 2.18.0` and `snforge 0.63.0`.

Seven tests cover the three properties worth proving:

| | |
|---|---|
| **Solvency** | payouts never exceed escrow — a break creates collateral from nothing |
| **Escrow** | submit returns an empty deposit span, or the pool pulls the collateral back out |
| **Clearing** | the price maximises matched volume; allocation respects price priority |

## Deploy

```bash
sncast account create --network sepolia --name atrum_sepolia   # then fund it
STRK20_TOKEN=0x... STRK20_OWNER=0x... ./scripts/deploy.sh sepolia
```

Pool addresses are baked into the deploy script:

| Network | STRK20 pool |
|---|---|
| Sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Build on Sepolia — it is free and the pool is real there. Mainnet is for the final deploy
and the demo.

## Known limitations

- **Unaudited.** The stateful-helper pattern this builds on is itself an unofficial example
  in the STRK20 docs, not shipped in the StarkWare monorepo.
- **Clearing is `O(99 x N)`.** It sweeps 99 price levels and re-walks every order at each
  one. Fine for a demo, and it needs cumulative sums before it is real — measured at ~132M
  L2 gas for four orders.
- **Owner-resolved.** No oracle. `resolve()` trusts a single address.
- **Commit–reveal has a non-reveal hole.** Nothing forces a trader to reveal an order that
  moved against them; a forfeitable bond is the standard fix and is not implemented.
- **Order size is public.** STRK20 measures amounts on-chain, so what is sealed is your
  side and your limit price — which is what a front-runner would need.
