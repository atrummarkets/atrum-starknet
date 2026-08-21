# Atrum — sealed-bid prediction markets on Starknet

A prediction market where **your order is unreadable until it is already binding**, and
where a position can be sold before the event resolves.

Built for the STRK20 Private Sprint, against two RFPs at once:

- **RFP-07** — prediction markets with visible odds and invisible bettors
- **RFP-08** — sealed-bid auctions where the bids are actually sealed

## The problem

Prediction markets show everyone your position. That is fine until the thing you are
betting on makes being seen expensive — betting against a ruling party in a jurisdiction
where that is legally grey, or holding a view your employer would read as disloyalty.
Polymarket cannot serve those users, because positions there are public by construction.

The naive fix — hide everything — breaks the product. A prediction market's whole social
value is the price it produces. Hide the price and you have a private casino, not a market.

## The design

A **sealed-bid batch auction** with a uniform clearing price.

1. Orders are submitted as private notes. Nobody can read them — not other traders, not us.
2. The batch closes. Only then does anything clear.
3. A uniform clearing price is computed and published.
4. Fills are claimed privately.

Because every order is already committed when the batch closes, **front-running is not
discouraged or penalised — it is structurally impossible.** There is no moment at which
someone can see your order and still act on it.

### What is private here, stated precisely

STRK20 and the Monad build hide different things, and this project is built around what
STRK20 actually provides rather than around what the previous version did.

| | Visible | Hidden |
|---|---|---|
| Who placed an order | | yes |
| Which side you took | | until the batch closes |
| Your limit price | | until the batch closes |
| Order size | yes | |
| Clearing price and volume | yes | |

Amounts entering and leaving the pool through a helper contract are **public** — the
`privacy_invoke` sandwich measures them on-chain, so they cannot be fixed at proof time. The
owner of the resulting note is still hidden.

**Sealed direction and price is what makes front-running impossible**, and that is the claim
this project makes. A front-runner needs to know which way you are going and at what price;
knowing that *someone* committed some collateral tells them nothing they can trade on.

Size privacy is available on top of this by quoting in fixed denominations, so that every
order looks identical and the public amount carries no information. That is the same
technique the Monad build uses for withdrawals, and whether it is worth the UX cost is a
decision for after the mechanism works.

Positions use the conditional-token model, and that is what makes an exit real rather than
notional. One YES plus one NO is a complete set worth exactly 100 whichever way the event
goes — so a holder of both can merge them for 100 **immediately**, with no counterparty, no
permission, and no waiting for the result.

Selling YES is therefore the same trade as buying NO. Buy YES in batch 3, buy NO in batch 7,
merge, withdraw. The difference between what you paid and 100 is your profit, taken while the
market is still open.

It is also why both sides escrow. A "sell" that escrowed nothing would be visibly a sell —
escrow amounts are public, so a zero would leak the side the seal exists to protect.

## Why this needs no sorting

Matching normally means comparing orders, and you cannot compare values you cannot read.

But a clearing price is where aggregate demand crosses aggregate supply, and **both curves
are cumulative sums.** Quantise price into levels; the demand curve is non-increasing, so an
order's contribution is a single step at its own limit. An order therefore lands on exactly
one price level, and the aggregate at any price is a suffix sum.

No sorting network. The price grid is the fixed structure sorting would otherwise have to
discover.

## Why STRK20

The privacy layer already exists and is StarkWare's to maintain — notes, nullifiers, viewing
keys, proving, live on mainnet. This project builds only the market mechanism on top of it.

That removes the three heaviest liabilities of a from-scratch private market: no trusted
setup ceremony of our own, no single decryption committee, and no risk of circuit artifacts
drifting from deployed verifiers.

## Prior work

The mechanism here was designed and measured on Monad before this sprint, in
[atrum-core](https://github.com/atrummarkets/atrum-core). Relevant findings that carry over:

- Clearing without decrypting any individual order is **cheaper** than opening the batch
  above roughly eleven orders per batch — privacy is not a premium here, it is a discount.
- Routing orders to price levels costs constraints linear in orders x levels, not the
  `N log^2 N` a sorting network would cost.
- Binding a batch by a running hash chain beats per-order membership proofs by ~20x, **and**
  gives the stronger property: it proves no order was dropped, which membership proofs do
  not.

Full measurement register: [`V2_EVIDENCE.md`](https://github.com/atrummarkets/atrum-core/blob/main/V2_EVIDENCE.md).

## What is built

### Contracts

A **factory** deploys markets and indexes them on-chain. Its auction class hash is set in
the constructor with **no setter** — every market it has produced, or ever will, runs the
same code. That is the whole reason reading one market tells you anything about the next.

Creation is **permissionless**, and the creator becomes their own market's resolver. What
stops that being a rug: the question and resolution source are fixed at creation, the
outcome can only be published inside a stated window, and once that window passes **anyone**
can refund every holder at cost. A creator can be *wrong*. They cannot steal, cannot freeze
funds, and cannot touch another market.

Only `resolve` is gated on an address. Submitting, revealing, clearing, settling, merging,
redeeming, withdrawing and forcing a refund are all open to anyone.

**19 tests**, covering the three properties that matter: solvency (every matched unit is
funded exactly 100 and exactly 100 comes back out), escrow (submit returns an *empty*
deposit span, or the pool pulls the collateral straight back), and early exit (a position
bought in one batch is cashed out in a later one with the market still unresolved).

### The app

| Route | |
|---|---|
| `/app` | markets index, read from the factory's on-chain index |
| `/app/market/[address]` | one market: price history, order ticket, position, exit |
| `/app/portfolio` | positions across every market |

The index is not a hardcoded list — it walks the factory, so a market a stranger creates
appears without anyone shipping a build.

**Check the privacy yourself.** Pick an order you placed and the app fetches the transaction
that carried it, then reports who actually submitted it and whether your address appears
anywhere in the calldata. It is built to *fire*: if the address turns up, it says so in red.
A check that could only return "you are safe" would train people to trust something that
never triggers.

**Autopilot.** Closing, clearing and settling a batch take no permission, so the app does
them when they come due instead of leaving a trader to wait for a stranger. It also reveals
your orders — miss that window and your trade silently does not happen. Every action names
itself before it runs and can be switched off, because revealing makes your side and limit
public and spending your gas is not a decision to make quietly.

**Price history.** One clearing price per batch, read from the chain. Batches that never
cleared are left out rather than drawn as zero — a gap is honest, a 0% is not.

### Verified rather than assumed

- The browser's commitment hashing is asserted against reference vectors printed by Cairo
  (`scripts/check-hashing.mjs`). If the two ever disagreed, an order could never be revealed
  and its escrow would be stranded — with both sides looking correct in isolation.
- Every gas and fee figure is measured, including the pool's flat fee, read live from
  `get_fee_amount` rather than trusted from a doc. See [DEPLOYMENTS.md](DEPLOYMENTS.md).

## Status

**Live on Starknet Sepolia. Nothing on mainnet, nothing here holds real value.**

Three markets are live, created through the factory. Addresses and the measured costs are in
[DEPLOYMENTS.md](DEPLOYMENTS.md).

## Honest limitations

- **You must enrol with the pool once before anything works.** Turn on privacy in your
  wallet, or use [strk20.starknet.io/app](https://strk20.starknet.io/app). The wallet API
  exposes no registration call to apps, deliberately: the viewing key is derived from a
  signature, and a key derived even slightly differently enrols *successfully* and then
  silently fails to decrypt anything ever sent to you. That derivation belongs with whoever
  holds the key.
- **Ready is currently the only wallet with STRK20 support.** That is a narrow funnel and
  not ours to widen.
- **Resolution is a named address, not an oracle.** A price oracle can settle "will STRK be
  below X" and cannot settle "will party Y win" — no feed for it exists. An optimistic oracle
  is the honest answer for the second kind and is not in this version. Pyth would have
  covered the first, and its Starknet support ends 26 Aug 2026; Chainlink is Sepolia-only;
  Pragma is the viable route and is not wired yet.

- **Anonymity scales with participation.** A sparse batch is both an inactive market and a
  weak anonymity set. This is a property of the mechanism; cryptography does not fix it.
- **Batches clear periodically, not continuously.** For markets resolving over hours or days
  this is immaterial — and continuous matching is what leaks by construction.
- **One leak is irreducible.** If your order filled, your limit was on the winning side of
  the clearing price, and the order at the margin is partially filled. Small, and disclosed
  rather than mitigated.

## Licence

Apache-2.0
