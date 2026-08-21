# Keeper

Runs the three calls a round needs — close, clear, settle — so a trader never has to.

Without it, someone has to click those in a browser. With it, placing a bet and seeing a
result is the whole user experience, and the machinery disappears.

## What it will not do

**Reveal.** That needs the bettor's own secret, and a keeper that could reveal an order could
read an order — which would make sealing decoration. Revealing stays with whoever placed the
bet. That is the one step that is theirs by construction, not by omission.

## What it cannot do, even if compromised

Every call it makes is permissionless and none of them touch money or outcomes. A stolen
keeper key cannot move a stake, settle a market, choose a winner, exclude a revealed bet, or
clear a round before its reveal window has closed. The worst it can do is advance rounds,
which anyone may do anyway.

That last item used to be on the other list. See below.

## It holds no state

Not as an implementation detail — it is the property that makes the thing deployable.

Every deadline it acts on is read from the chain on each pass. So a restart, a redeploy, a
crash or a platform migration costs a round nothing but a little time, several keepers can run
without coordinating, and there is no disk, database or graceful shutdown that has to work for
it to stay correct.

## Run it

```bash
npm ci
KEEPER_FACTORY=0x…  \
KEEPER_ADDRESS=0x…  \
KEEPER_PRIVATE_KEY=0x…  \
npm start
```

`npm run once` does a single pass, which is what you want from cron.

| Variable | Default | |
|---|---|---|
| `KEEPER_FACTORY` | — | required, the factory to read markets from |
| `KEEPER_ADDRESS` | — | required, the account that signs |
| `KEEPER_PRIVATE_KEY` | — | required |
| `KEEPER_RPC` | Sepolia | public endpoints rate-limit; a rate-limited keeper looks exactly like a dead one |
| `KEEPER_POLL_MS` | 30000 | |
| `KEEPER_MIN_BETS` | 2 | bets needed before a round closes — one order cannot cross with anything |

There is deliberately no reveal-window setting. It is not configurable here because it is not
this process's decision to make.

Use a **dedicated account with a little gas and nothing else**. It needs no privileges, and
giving it any would be giving it privileges the protocol does not have.

## Deploying it

Two supported ways to run the same code.

| | cadence | cost | |
|---|---|---|---|
| [`render.yaml`](../render.yaml) | continuous, 30s | paid worker | rounds turn over promptly |
| [`.github/workflows/keeper.yml`](../.github/workflows/keeper.yml) | every 5 min | free | rounds turn over eventually |

A worker, not a web service: nothing ever calls the keeper, so an HTTP port would go unused,
and a free web service is slept after fifteen minutes without requests — which for a process
whose whole job is to keep polling is failure, not idleness.

Pick on how quickly rounds should turn over. **The cadence is a latency decision, not a
security one** — which is only true because of the next section.

## The setting that used to matter ethically

`KEEPER_REVEAL_WINDOW_MS` is gone. What it did is now enforced by the contract.

The problem it existed for is real. Whoever calls `clear` fixes the reveal cutoff, so a keeper
that cleared the instant a round closed would silently exclude every bet whose owner had not
yet revealed — their stake comes back, but their bet never happened. Done deliberately and
repeatedly, that is censorship that leaves no trace on-chain.

A keeper-side timer was a bad answer to it, in three ways at once:

- **unverifiable** — nobody outside the process could check the wait had happened
- **unenforceable** — a keeper that skipped it produced an identical on-chain record
- **lost on restart** — and for anything deployed, that means lost on every deploy

So the chain holds it. `close_batch` stamps the block timestamp, `clear` refuses until
`reveal_window` seconds have passed, and the window is fixed when the market is created with
no setter anywhere. A trader can read `get_reveal_window()` **before committing money** and
know exactly how long they will have.

The floor (`MIN_REVEAL_WINDOW`, 60s) only blocks the degenerate case. The real protection is
that the value is public and immutable per market, so an unreasonably short window is visible
in advance rather than discovered afterwards.

Tests that pin this down, in `cairo/tests/auction.cairo`:

- `cannot_clear_in_the_same_breath_as_closing` — the hostile-keeper sequence, rejected
- `cannot_clear_one_second_early` — the boundary
- `clears_the_moment_the_window_closes` — a floor on waiting, not an added delay
- `a_late_revealer_is_still_in_the_auction` — the person this protects
- `a_later_round_cannot_borrow_the_first_rounds_elapsed_window` — per batch, not per market

## Running two is fine

Whoever gets there first advances the round; the other sees `WRONG_PHASE` and logs it as
already-done. That is the design working: the calls are permissionless so a market never
depends on one keeper being alive. If yours dies, a stranger's does the job — and because the
reveal window is on-chain, you do not have to trust the stranger's configuration either.
