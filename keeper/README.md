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
keeper key cannot move a stake, settle a market, choose a winner, or exclude a bet that has
been revealed. The worst it can do is advance rounds, which anyone may do anyway.

## Run it

```bash
npm install
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
| `KEEPER_RPC` | Sepolia | |
| `KEEPER_POLL_MS` | 30000 | |
| `KEEPER_MIN_BETS` | 2 | bets needed before a round closes |
| `KEEPER_REVEAL_WINDOW_MS` | 180000 | how long to leave a round open for reveals |

Use a **dedicated account with a little gas and nothing else**. It needs no privileges, and
giving it any would be giving it privileges the protocol does not have.

## The one setting that matters ethically

`KEEPER_REVEAL_WINDOW_MS`.

Whoever calls `clear` fixes the reveal cutoff, and **the contract does not enforce a
minimum**. A keeper that cleared the instant a round closed would silently exclude every bet
whose owner had not yet revealed — their stake comes back, but their bet never happened. Done
deliberately and repeatedly, that is censorship that leaves no trace on-chain.

So this waits, generously, from the first moment it sees a round open for reveals, and clears
early only when everyone has already revealed. The cost of waiting too long is a slow market.
The cost of not waiting is other people's trades.

**This belongs in the contract**, not in a keeper's config — `clear` should refuse until a
minimum number of blocks after `close_batch`, so good behaviour is enforced rather than
requested. Until that ships, a well-behaved keeper is a promise, and it is worth knowing that.

## Running two is fine

Whoever gets there first advances the round; the other sees `WRONG_PHASE` and logs it as
already-done. That is the design working: the calls are permissionless so a market never
depends on one keeper being alive. If yours dies, a stranger's does the job.
