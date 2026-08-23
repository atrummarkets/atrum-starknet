# Eight days to mainnet

23–31 August 2026. Submissions close **31 Aug 23:59 UTC**.

This is the plan for turning what works into a product, in the order that the weakest thing
gets fixed first. Where something is deliberately not being done, it says so and why — a
roadmap that lists everything is a wish, not a plan.

## Where we actually stand

Verified, not assumed. Everything in this table was checked on chain or in a run.

| | |
|---|---|
| Contract | 28 tests. Reveal window enforced on chain, not by a keeper's manners |
| Sepolia | Factory `0x007159d8…9197`, 3 markets, all carrying their declared windows |
| Keeper | Own funded account, GitHub Actions every 5 min, holds no state |
| Lifecycle | Sealed → closed → revealed → cleared at 50 → settled, **end to end** |
| Merge | **Never exercised.** The exit is the whole thesis and it is untested |
| Mainnet | Nothing |
| `strk20.json` | Empty. The hub reads `verified_txs: 0` |
| The app | Built, gated behind `NEXT_PUBLIC_ENABLE_APP` — a judge clicking the link sees "not open yet" |
| Docs site | Still describes parimutuel on Monad. Wrong chain, wrong mechanism |

## What the score is actually made of

| Weight | Criterion | Where we are |
|---|---|---|
| 30% | Mainnet product | **Zero.** Nothing deployed, and the app is switched off |
| 30% | STRK20 integration depth | Strong — anonymizer contract, open notes, escrow via balance delta |
| 25% | Innovation | Strong — sealed-bid uniform-price auction is not a variation on anything in this space |
| 15% | Documentation | **Weak.** The public docs describe a different product |

Forty-five percent of the score is sitting at or near zero, and neither half of it is hard.
That is what sets the order below: **the first three days are worth more than the next five.**

---

## Day 1 — Sat 23 Aug — Prove the loop, completely

All free, all on a network where mistakes cost nothing, and it rehearses the exact sequence
that gets filmed later.

- **Merge, once.** ~5 minutes. This has never been clicked. If it is broken, today is when to
  find out, not on day seven.
- **A two-round profitable exit.** Everything demonstrated so far is the break-even version —
  both sides bought at the same price in one round, so the exit shows `0.00`. Buy YES at 40 in
  one round, NO at 30 in the next, merge for 100. The demo needs to show **+0.30**, because
  break-even demonstrates the machinery and profit demonstrates the point.
- **Watch the reveal countdown tick through a real closed round.** It is verified
  mathematically and has never been seen running.
- **Theme QA in a real browser.** Contrast is proven by `scripts/check-contrast.mjs`; *layout*
  in light mode is not. A headless browser could not run here for want of system libraries, so
  this is eyes on a screen.

## Day 2 — Sun 24 Aug — Mainnet

The single highest-value day. Budget **~48 of 192 STRK**.

- Declare auction + factory (~32 STRK — DECLARE is most of the cost), deploy the factory,
  create two markets.
- Three pool operations, which double as the eligibility transactions. **6 STRK each on
  mainnet against 2 on Sepolia** — three times the price, so no idle clicking.
- Fill `strk20.json` with the transaction hashes and contract addresses.
- Flip `NEXT_PUBLIC_ENABLE_APP=1` in Vercel — *after* the flow is proven, not before.

**Do not leave the first mainnet transaction until later in the week.** The wallet layer has
surprised us five separate times, and every one of them was Ready or STRK20 rather than our
contract. Mainnet gets a fresh chance to do that.

## Day 3 — Mon 25 Aug — Documentation

15% of the score, and currently the public docs describe the *Monad parimutuel* build. A judge
reading them learns about a product that no longer exists.

Four pages, in `atrum-docs`:

- How a sealed round works, start to finish, with a worked three-trader example.
- What STRK20 hides and what it does not — **amounts are public, identity is private**, the
  inverse of the Monad build.
- The reveal window: why a keeper-side timer was not a security property, and what replaced it.
- Trust boundaries: what a market creator can do, what they cannot, and who can refund you.

## Day 4 — Tue 26 Aug — The privacy gap

The most honest weak point in the claim "private prediction market", and it deserves a day.

On STRK20 **amounts are public**. Side and limit price are sealed, which is what a front-runner
needs — but *size* is not. A distinctive stake size identifies a bettor across rounds regardless
of how well the order is sealed.

Fix: **fixed denominations.** Bets in 1 / 5 / 25 share units, so a size stops being a
fingerprint. This is a UI and validation change, not a contract change.

## Day 5 — Wed 27 Aug — Resolution

Today a **named address** resolves each market. That is disclosed rather than hidden, and the
refund path bounds it — miss the deadline and anyone can refund every holder at cost.

Two honest options, decided on the day:

- Wire **Pragma**. Pyth's Starknet support ends 26 Aug and Chainlink is Sepolia-only, so Pragma
  is the only live route. Covers "will STRK close above X" and cannot cover "will party Y win".
- Or leave it, make the refund guarantee prominent in the UI, and say plainly that an
  optimistic oracle is the answer for non-price questions and is not in this version.

The second is not a cop-out if it is stated. Shipping a half-wired oracle would be worse.

## Day 6 — Thu 28 Aug — The video

Three minutes, hard requirement, currently missing. The cut:

1. A sealed bet. Show that **we** cannot read it either.
2. The reveal window counting down, and the contract refusing to clear early.
3. One clearing price, and a fill at better than the limit asked for.
4. Merge, for a profit, before the event has resolved.

Point 4 is the shot that separates this from a betting site. Record on mainnet if it is stable
by then, Sepolia if not — and say which.

## Day 7 — Fri 29 Aug — Hardening

The unglamorous list that decides whether it feels like a product:

- Empty and error states on every route. A first-time visitor with no wallet should never see
  a blank panel.
- Mobile. Untested at any width.
- Keeper monitoring — right now a dead keeper is silent, and silence looks identical to "no
  rounds due".

## Day 8 — Sat 30 Aug — Submit, with a day spare

Submit on the 30th, not the 31st. A deadline day spent submitting is a deadline day not spent
fixing whatever submitting reveals.

---

## Deliberately not doing

- **Multi-wallet support.** Ready is the only wallet with STRK20 today. That is a narrow funnel
  and it is not ours to widen.
- **Threshold encryption so reveals can be automated.** It would remove the one step a trader
  cannot delegate, and it needs a committee and a ceremony. Real, and not eight days of work.
- **An optimistic oracle.** The correct answer for non-price questions, and a project in itself.
- **Anything that makes the demo look better without being true.** If a thing is not wired, the
  docs and the video say it is not wired.

## What already makes this a product rather than a demo

Worth stating, because it is the part that is easy to skip and impossible to retrofit:

- The reveal window is **enforced by the contract**, so no keeper has to be trusted to be
  polite — and a trader can read the guarantee with `get_reveal_window()` *before* committing
  money.
- The keeper **holds no state**, so it is restart-safe, replicable, and safe for a stranger to
  run against your markets without you trusting their configuration.
- Contrast is asserted mechanically in both themes, along with the browser's hashing against
  Cairo. Both guard properties that fail *silently* — a palette below AA still renders, and a
  diverging hash still produces a commitment.
- Every gas and fee figure in the repo is measured, including the pool fee, read live from
  `get_fee_amount` rather than trusted from a doc.

## The risks worth naming

| Risk | Why it matters |
|---|---|
| The wallet layer | Five surprises so far, none of them our contract. Mainnet may add a sixth |
| Merge is untested | It is the climax of the demo and has never run |
| Mainnet costs 3× | 6 STRK per pool operation. Fine at 192, not free |
| Ready is the only wallet | A judge without it cannot try the product at all |
| Pragma in one day | Might not land. Day 5 has an explicit fallback for exactly that reason |
