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

What becomes public is the clearing price and total volume. That is the forecast, and it is
the part that *should* be public. Individual sizes, sides and limit prices never are.

Positions use the conditional-token model: one unit of collateral mints one YES and one NO,
the winner redeems for one and the loser for zero. That is what makes a position tradeable
before the event resolves.

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

## Status

Sprint build in progress. Nothing here holds real value yet.

## Honest limitations

- **Anonymity scales with participation.** A sparse batch is both an inactive market and a
  weak anonymity set. This is a property of the mechanism; cryptography does not fix it.
- **Batches clear periodically, not continuously.** For markets resolving over hours or days
  this is immaterial — and continuous matching is what leaks by construction.
- **One leak is irreducible.** If your order filled, your limit was on the winning side of
  the clearing price, and the order at the margin is partially filled. Small, and disclosed
  rather than mitigated.

## Licence

Apache-2.0
