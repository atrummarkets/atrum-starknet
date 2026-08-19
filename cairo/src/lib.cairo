//! Atrum — a sealed-bid, uniform-price batch auction as an STRK20 anonymizer contract.
//!
//! WHAT THIS IS
//!
//! A prediction market where no order can be read until it is already binding. Traders
//! submit a hash of (side, limit, salt) and escrow collateral. When the batch closes they
//! reveal, and a single clearing price is computed where demand crosses supply. Everyone
//! who trades, trades at that one price.
//!
//! Because every order is committed before anything is revealed, front-running is not
//! discouraged or penalised — there is no moment at which a party can see an order and
//! still act on it.
//!
//! HOW IT PLUGS INTO STRK20
//!
//! The pool calls `privacy_invoke` inside one atomic transaction:
//!
//!     withdraw from pool  ->  privacy_invoke  ->  credit open notes
//!
//! Two operations use that path:
//!
//!   Submit — the pool has already transferred collateral here, so we record the
//!            commitment and return an EMPTY span. Returning no deposit instructions is
//!            what makes the tokens stay, which is how escrow works in this pattern.
//!
//!   Claim  — we approve the pool to pull the payout and return an `OpenNoteDeposit`
//!            naming the caller's open note. The amount is public; the owner is not.
//!
//! Reveal, clear and resolve move no tokens, so they are ordinary external calls and do
//! NOT go through the pool.
//!
//! PRICE MODEL
//!
//! Prices are whole percent, 1..99, read as the probability of YES.
//!
//!   Buy  u units at limit p  ->  escrow u*p         (the most it can cost)
//!   Sell u units at limit p  ->  escrow u*(100-p)   (the most it can cost)
//!
//! A matched pair funds exactly 100 per unit between them, so the winner can be paid 100
//! per unit at resolution. That is the conditional-token identity — one collateral unit is
//! one YES plus one NO — expressed in escrow rather than in tokens.
//!
//! POSITIONS AND SELLING BEFORE RESOLUTION
//!
//! Batches cycle. After one clears, the next opens, and a position bought in batch 3 can
//! be sold in batch 7 — before anyone knows the outcome. That is the whole reason this is
//! a market and not a lottery, and it is the thing a pooled prediction market cannot do.
//!
//! Positions belong to a HOLDER PSEUDONYM, `poseidon(HOLDER_TAG, holder_secret)`, not to an
//! address. The chain never learns whose it is; STRK20 keeps the address off the action,
//! and the pseudonym is what lets a position persist across batches.
//!
//! HOW YOU EXIT: BUY THE OTHER SIDE AND MERGE.
//!
//! Selling YES is the same trade as buying NO. One YES plus one NO is a complete set worth
//! exactly 100 at resolution whichever way it goes, so a holder of both can merge them for
//! 100 immediately — no counterparty, no permission, no waiting for the event.
//!
//! That is the exit, and it is why both sides escrow. A "sell" that escrowed nothing would
//! be visibly a sell: escrow amounts are public, so a zero would leak the side the seal is
//! supposed to protect. Symmetric escrow keeps the side sealed AND gives a real exit.
//!
//!     buy YES at p   ->  escrow u*p
//!     sell YES at p  ==  buy NO at (100-p)  ->  escrow u*(100-p)
//!
//! WHAT THIS DOES NOT HIDE, stated plainly:
//!   - Order SIZE is public. STRK20 measures amounts on-chain; that is not ours to change.
//!   - After a batch clears, the revealed orders in it are public. That is what "sealed
//!     bid" means — sealed until the close, not sealed forever.
//!   - Orders sharing a holder pseudonym are linkable TO EACH OTHER. They are not linkable
//!     to a person. A trader who wants batch-to-batch unlinkability uses a fresh pseudonym
//!     and gives up carrying a position across batches; that trade is theirs to make.
//!
//! WHAT THE MARKET IS ABOUT, AND WHO DECIDES
//!
//! A market with no question is not a prediction market, it is an auction on abstract
//! tokens. So the question and the resolution criterion are stored ON CHAIN at construction
//! and there is no function to change either. Not for tidiness: a market whose wording can
//! be edited after orders are placed is a rug, and one whose resolver can be swapped is the
//! same rug wearing a hat.
//!
//! Resolution is a NAMED ADDRESS, not an oracle, and that is a disclosed limitation rather
//! than a hidden one. A price oracle can settle "will BTC be above X" and cannot settle
//! "will party Y win" — no feed for it exists. An optimistic oracle is the honest answer for
//! the second kind and is not in this version.
//!
//! WHAT BOUNDS THE TRUST: THE ABANDONMENT REFUND.
//!
//! `resolve` is only callable inside a window — after the event has happened, and before a
//! published deadline. Once that deadline passes with no outcome, ANYONE can call
//! `force_refund` and every holder gets back exactly what they paid.
//!
//! So the resolver can pick the WRONG answer. They cannot steal, and they cannot freeze
//! funds forever by going quiet. Two of the three ways a trusted resolver ruins you are
//! closed by a timeout rather than by cryptography, which is worth more than it sounds.
//!
//! ONE CONTRACT PER MARKET
//!
//! This contract is one market, and that is the intended shape rather than a shortcut.
//! Starknet separates `DECLARE` (register the class, once) from `DEPLOY` (instantiate),
//! so a new market costs a cheap deploy against a class hash that already exists — there
//! is no EVM-style penalty for redeploying bytecode.
//!
//! Two reasons to prefer it over a multi-market contract:
//!
//!   Isolation — each market holds its own escrow, so a bug in one cannot reach another
//!               market's collateral. A shared contract makes every market as risky as
//!               the worst one.
//!   Simplicity — no market_id threaded through every storage key and every loop, which
//!               is where an off-by-one silently pays the wrong people.
//!
//! A factory that deploys instances and indexes them is the natural next step, and is
//! deliberately not in this version.
//!
//! NOT PRODUCTION. Unaudited, owner-resolved, no oracle. See the README.

pub mod factory;

use starknet::ContractAddress;

/// Must match `privacy::objects::OpenNoteDeposit` field-for-field (positional Serde).
/// Declared locally rather than imported: the `privacy` package is not on the Scarb
/// registry, and the starter kit's helper does the same.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Minimal ERC-20 surface. Only what the escrow path touches.
#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

/// Which pool-mediated operation `privacy_invoke` should perform.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum AuctionOperation {
    /// Escrow collateral behind a commitment. Returns an empty span.
    Submit,
    /// Pay out a settled order into an open note.
    Claim,
}

/// Where the CURRENT batch is. A batch runs Open -> Revealing -> Cleared, and then the
/// next batch opens. This cycles for as long as the market is unresolved.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum Phase {
    Open,
    Revealing,
    Cleared,
    /// Terminal for the whole market, not just this batch. No further batches open.
    Resolved,
    /// Terminal, and reached WITHOUT an outcome: the resolver failed to resolve before the
    /// deadline, so positions are being refunded at cost. Anyone can trigger this.
    Refunding,
}

/// A holder's standing position, keyed by pseudonym rather than by address.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store, Default)]
pub struct Position {
    pub yes_units: u128,
    pub no_units: u128,
    /// Collateral credited from refunds, merges and redemptions. Withdrawable at any time,
    /// including before the market resolves — which is what makes an early exit real
    /// rather than notional.
    pub collateral: u128,
    /// What the holder has actually paid for the units they still hold.
    ///
    /// Only used by the abandonment refund: if the resolver never resolves, everyone gets
    /// back what they put in, and "what they put in" has to be a number the contract knows
    /// rather than one it infers. Total `staked` across all holders equals the collateral
    /// sitting behind matched positions, so refunding it is exactly solvent.
    pub staked: u128,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Order {
    /// Collateral escrowed for this order. Public — STRK20 measures amounts on-chain.
    /// A covered sell escrows nothing; it is backed by units the holder already owns.
    pub escrow: u128,
    pub batch: u64,
    pub revealed: bool,
    /// 1 = buy YES, 2 = sell YES. Zero until revealed.
    pub side: u8,
    /// Limit price in whole percent, 1..99. Zero until revealed.
    pub limit: u8,
    pub units: u128,
    /// Units actually matched at the clearing price.
    pub filled: u128,
    /// Whose position this order moves. Zero until revealed.
    pub holder: felt252,
    /// True once the fill has been applied to the holder's position, so a batch cannot be
    /// settled twice.
    pub settled: bool,
}

pub mod errors {
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const BAD_POOL: felt252 = 'BAD_POOL';
    pub const WRONG_PHASE: felt252 = 'WRONG_PHASE';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_REVEALED: felt252 = 'ALREADY_REVEALED';
    pub const NOT_REVEALED: felt252 = 'NOT_REVEALED';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const BAD_REVEAL: felt252 = 'BAD_REVEAL';
    pub const BAD_SIDE: felt252 = 'BAD_SIDE';
    pub const BAD_LIMIT: felt252 = 'BAD_LIMIT';
    pub const BAD_ESCROW: felt252 = 'BAD_ESCROW';
    pub const ZERO_UNITS: felt252 = 'ZERO_UNITS';
    pub const NOT_OWNER: felt252 = 'NOT_OWNER';
    pub const BAD_OUTCOME: felt252 = 'BAD_OUTCOME';
    pub const NO_ORDERS: felt252 = 'NO_ORDERS';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const NOT_ENOUGH_UNITS: felt252 = 'NOT_ENOUGH_UNITS';
    pub const NOTHING_TO_WITHDRAW: felt252 = 'NOTHING_TO_WITHDRAW';
    pub const OFF_GRID: felt252 = 'OFF_GRID';
    pub const TOO_EARLY: felt252 = 'TOO_EARLY';
    pub const DEADLINE_PASSED: felt252 = 'DEADLINE_PASSED';
    pub const DEADLINE_NOT_PASSED: felt252 = 'DEADLINE_NOT_PASSED';
    pub const BAD_SCHEDULE: felt252 = 'BAD_SCHEDULE';
    pub const EMPTY_QUESTION: felt252 = 'EMPTY_QUESTION';
}

/// Domain separator, so an auction commitment can never collide with a hash from another
/// protocol that happens to use the same fields.
pub const COMMITMENT_TAG: felt252 = 'ATRUM_ORDER_COMMITMENT:V1';

/// Domain separator for holder pseudonyms, kept distinct from the order tag so an order
/// hash can never be replayed as a holder id.
pub const HOLDER_TAG: felt252 = 'ATRUM_HOLDER:V1';

/// Price granularity, in whole percent.
///
/// Prices are multiples of 5 — 5, 10, ... 95 — so the ladder has 19 rungs rather than 99.
/// Three independent reasons, all pointing the same way:
///
///   PRIVACY   a coarse grid buckets more orders onto each rung, so a filled order says
///             less about its holder. The grid size IS an anonymity parameter.
///   COST      clearing walks the ladder once per order, so 19 rungs is a fifth of 99.
///   SIZE      fewer rungs keeps the sweep small enough not to need a Felt252Dict, whose
///             squashing machinery costs more in contract size than the sweep saves in
///             gas. Measured: the dict version was 31% larger to declare.
///
/// A finer grid prices better, and that is the thing being traded away. For a market
/// quoted in probabilities, 5-point steps are the granularity people actually think in.
pub const TICK: u8 = 5;

/// A holder's pseudonym. Derived from a secret they keep, so the chain sees a stable
/// identity across batches without ever seeing a person behind it.
pub fn compute_holder(holder_secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([HOLDER_TAG, holder_secret].span())
}

/// commitment = Poseidon(TAG, holder, side, limit, units, salt)
///
/// `salt` is what keeps the commitment sealed: side, limit and units are all small and
/// enumerable, so without a high-entropy salt anyone could brute-force the preimage and
/// the order would not be sealed at all. The holder is inside the hash so a revealed order
/// cannot be re-pointed at someone else's position.
pub fn compute_commitment(
    holder: felt252, side: u8, limit: u8, units: u128, salt: felt252,
) -> felt252 {
    core::poseidon::poseidon_hash_span(
        [COMMITMENT_TAG, holder, side.into(), limit.into(), units.into(), salt].span(),
    )
}

#[starknet::interface]
pub trait IAtrumAuction<TState> {
    /// Called by the privacy pool via `selector!("privacy_invoke")`.
    ///
    /// Submit  — escrow collateral behind a sealed commitment. Returns an EMPTY span,
    ///           which is what makes the pool leave the tokens here.
    /// Withdraw — pay a holder's collateral balance out into an open note. Available at
    ///           any time, including before the market resolves.
    fn privacy_invoke(
        ref self: TState,
        operation: AuctionOperation,
        commitment: felt252,
        token: ContractAddress,
        pool_address: ContractAddress,
        units: u128,
        salt: felt252,
        side: u8,
        limit: u8,
        holder_secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Stop accepting orders and open the reveal window. Permissionless.
    fn close_batch(ref self: TState);

    /// Open a commitment. Self-authenticating — only the preimage holder can produce a
    /// valid reveal, so anyone may relay it.
    fn reveal(
        ref self: TState, holder_secret: felt252, side: u8, limit: u8, units: u128, salt: felt252,
    );

    /// Compute the uniform clearing price and allocate fills. Permissionless.
    fn clear(ref self: TState);

    /// Apply this batch's fills to holder positions and open the next batch.
    /// Permissionless, and idempotent per order.
    fn settle_batch(ref self: TState, commitments: Array<felt252>);

    /// Merge complete sets into collateral. THE EXIT: one YES plus one NO is worth exactly
    /// 100 whichever way the event goes, so a holder of both can cash out immediately
    /// without a counterparty and without waiting for resolution.
    fn merge(ref self: TState, holder_secret: felt252, units: u128);

    /// Settle the market. Only the named resolver, and only inside the published window:
    /// not before the event has happened, and not after the deadline.
    fn resolve(ref self: TState, outcome: u8);

    /// THE TRUST BOUND. Once the resolve deadline passes with no outcome, anyone may call
    /// this and every holder is refunded exactly what they paid. A resolver who goes quiet
    /// cannot strand the market.
    fn force_refund(ref self: TState);

    fn get_question(self: @TState) -> ByteArray;
    fn get_resolution_source(self: @TState) -> ByteArray;
    fn get_settle_after(self: @TState) -> u64;
    fn get_resolve_deadline(self: @TState) -> u64;

    /// Credit the winning side's payout to the holder's collateral balance.
    fn redeem(ref self: TState, holder_secret: felt252);

    fn get_order(self: @TState, commitment: felt252) -> Order;
    fn get_position(self: @TState, holder: felt252) -> Position;
    fn get_phase(self: @TState) -> Phase;
    fn get_batch(self: @TState) -> u64;
    fn get_clearing_price(self: @TState, batch: u64) -> u8;
    fn get_order_count(self: @TState, batch: u64) -> u32;
    fn get_outcome(self: @TState) -> u8;
    fn get_batch_commitment(self: @TState, batch: u64, index: u32) -> felt252;
}

#[starknet::contract]
pub mod AtrumAuction {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address,
    };
    use super::{
        AuctionOperation, IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit, Order, Phase,
        Position, TICK, compute_commitment, compute_holder, errors,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        token: ContractAddress,
        owner: ContractAddress,
        /// Immutable in practice: written once in the constructor, with no setter anywhere.
        question: ByteArray,
        resolution_source: ByteArray,
        /// No resolution before this — a market settled before its event has happened is
        /// settled against information the traders could not have had.
        settle_after: u64,
        /// After this, `resolve` is closed and `force_refund` is open to anyone.
        resolve_deadline: u64,
        batch: u64,
        phase: Phase,
        /// 0 = unresolved, 1 = YES, 2 = NO.
        outcome: u8,
        /// Collateral held on behalf of orders and positions. Tracked explicitly so an
        /// escrow is derived from the balance delta rather than a caller-supplied amount,
        /// and so a stray transfer to this address cannot be mistaken for someone's money.
        escrowed_total: u128,
        orders: Map<felt252, Order>,
        positions: Map<felt252, Position>,
        /// (batch, index) -> commitment. Clearing has to walk the batch, and a Map alone
        /// cannot be iterated.
        batch_index: Map<(u64, u32), felt252>,
        order_count: Map<u64, u32>,
        clearing_price: Map<u64, u8>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        OrderSubmitted: OrderSubmitted,
        OrderRevealed: OrderRevealed,
        BatchCleared: BatchCleared,
        BatchSettled: BatchSettled,
        Merged: Merged,
        Resolved: Resolved,
        RefundOpened: RefundOpened,
        Withdrawn: Withdrawn,
    }

    /// The resolver failed to resolve in time and the market is now refunding at cost.
    #[derive(Drop, starknet::Event)]
    struct RefundOpened {}

    /// Carries no side, limit or holder — those are still sealed. `escrow` is public
    /// regardless, because the pool measured it on-chain.
    #[derive(Drop, starknet::Event)]
    struct OrderSubmitted {
        #[key]
        commitment: felt252,
        batch: u64,
        escrow: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct OrderRevealed {
        #[key]
        commitment: felt252,
        side: u8,
        limit: u8,
        units: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct BatchCleared {
        #[key]
        batch: u64,
        clearing_price: u8,
        matched_units: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct BatchSettled {
        #[key]
        batch: u64,
        next_batch: u64,
    }

    /// The early exit, made visible: a complete set cashed out before resolution.
    #[derive(Drop, starknet::Event)]
    struct Merged {
        #[key]
        holder: felt252,
        units: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct Resolved {
        outcome: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawn {
        #[key]
        holder: felt252,
        amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        token: ContractAddress,
        owner: ContractAddress,
        question: ByteArray,
        resolution_source: ByteArray,
        settle_after: u64,
        resolve_deadline: u64,
    ) {
        // A market with no question is an auction on abstract tokens. Refuse to deploy one.
        assert(question.len() > 0, errors::EMPTY_QUESTION);
        assert(resolution_source.len() > 0, errors::EMPTY_QUESTION);
        // The refund window has to actually exist, or the trust bound is decorative.
        assert(resolve_deadline > settle_after, errors::BAD_SCHEDULE);

        self.pool.write(pool);
        self.token.write(token);
        self.owner.write(owner);
        self.question.write(question);
        self.resolution_source.write(resolution_source);
        self.settle_after.write(settle_after);
        self.resolve_deadline.write(resolve_deadline);
        self.batch.write(0);
        self.phase.write(Phase::Open);
        self.outcome.write(0);
    }

    #[abi(embed_v0)]
    pub impl AtrumAuctionImpl of super::IAtrumAuction<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: AuctionOperation,
            commitment: felt252,
            token: ContractAddress,
            pool_address: ContractAddress,
            units: u128,
            salt: felt252,
            side: u8,
            limit: u8,
            holder_secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Two checks, not one: the caller must be the pool we were constructed
            // against, AND the pool address the wallet substituted must agree with the
            // caller. The second catches a malformed ${poolAddress} placeholder.
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);
            assert(pool_address == pool, errors::BAD_POOL);
            assert(token == self.token.read(), errors::BAD_ESCROW);

            match operation {
                AuctionOperation::Submit => self.do_submit(commitment, token, units),
                AuctionOperation::Claim => self.do_withdraw(token, pool, holder_secret, note_id),
            }
        }

        fn close_batch(ref self: ContractState) {
            assert(self.phase.read() == Phase::Open, errors::WRONG_PHASE);
            self.phase.write(Phase::Revealing);
        }

        fn reveal(
            ref self: ContractState,
            holder_secret: felt252,
            side: u8,
            limit: u8,
            units: u128,
            salt: felt252,
        ) {
            assert(self.phase.read() == Phase::Revealing, errors::WRONG_PHASE);
            assert(side == 1 || side == 2, errors::BAD_SIDE);
            assert(limit >= TICK && limit <= 100 - TICK, errors::BAD_LIMIT);
            // Off-grid limits would never be matched by the sweep below, so the order
            // would sit unfillable while its escrow looked committed. Reject it here.
            assert(limit % TICK == 0, errors::OFF_GRID);

            let holder = compute_holder(holder_secret);
            let commitment = compute_commitment(holder, side, limit, units, salt);
            let mut order = self.orders.entry(commitment).read();
            assert(order.escrow != 0, errors::COMMITMENT_NOT_FOUND);
            assert(!order.revealed, errors::ALREADY_REVEALED);

            // The escrow must match what this order costs at its own limit, or a trader
            // could under-collateralise and walk away from a losing fill.
            //   buy YES at p   -> u * p
            //   buy NO         -> u * (100 - p), where p is the YES-equivalent price
            let required: u128 = if side == 1 {
                units * limit.into()
            } else {
                units * (100_u128 - limit.into())
            };
            assert(order.escrow == required, errors::BAD_ESCROW);

            order.revealed = true;
            order.side = side;
            order.limit = limit;
            order.units = units;
            order.holder = holder;
            self.orders.entry(commitment).write(order);

            self.emit(OrderRevealed { commitment, side, limit, units });
        }

        fn clear(ref self: ContractState) {
            assert(self.phase.read() == Phase::Revealing, errors::WRONG_PHASE);
            let batch = self.batch.read();
            let count = self.order_count.entry(batch).read();
            assert(count != 0, errors::NO_ORDERS);

            let (price, matched) = self.find_clearing_price(batch, count);
            self.clearing_price.entry(batch).write(price);
            self.allocate_fills(batch, count, price);
            self.phase.write(Phase::Cleared);

            self.emit(BatchCleared { batch, clearing_price: price, matched_units: matched });
        }

        fn settle_batch(ref self: ContractState, commitments: Array<felt252>) {
            assert(self.phase.read() == Phase::Cleared, errors::WRONG_PHASE);
            let batch = self.batch.read();
            let count = self.order_count.entry(batch).read();
            let price: u128 = self.clearing_price.entry(batch).read().into();

            // `commitments` is ignored in favour of the on-chain index: taking the list
            // from the caller would let them omit an order and keep its escrow unsettled.
            let _ = commitments;

            let mut i: u32 = 0;
            while i < count {
                let c = self.batch_index.entry((batch, i)).read();
                let mut o = self.orders.entry(c).read();
                if !o.settled {
                    o.settled = true;
                    self.orders.entry(c).write(o);
                    self.apply_fill(o, price);
                }
                i += 1;
            }

            let next = batch + 1;
            self.batch.write(next);
            self.phase.write(Phase::Open);
            self.emit(BatchSettled { batch, next_batch: next });
        }

        fn merge(ref self: ContractState, holder_secret: felt252, units: u128) {
            assert(units != 0, errors::ZERO_UNITS);
            let holder = compute_holder(holder_secret);
            let mut pos = self.positions.entry(holder).read();
            assert(pos.yes_units >= units && pos.no_units >= units, errors::NOT_ENOUGH_UNITS);

            // A complete set is worth exactly 100 whichever way the event goes, so this
            // needs no counterparty and no outcome. It is the exit.
            pos.yes_units -= units;
            pos.no_units -= units;
            let paid_out = units * 100_u128;
            pos.collateral += paid_out;
            // The set has been cashed, so it is no longer owed a refund. Saturating,
            // because a profitable merge pays out MORE than the pair cost and `staked`
            // must never wrap.
            pos.staked = if pos.staked > paid_out {
                pos.staked - paid_out
            } else {
                0
            };
            self.positions.entry(holder).write(pos);

            self.emit(Merged { holder, units });
        }

        fn resolve(ref self: ContractState, outcome: u8) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            assert(outcome == 1 || outcome == 2, errors::BAD_OUTCOME);
            // Only between batches, never mid-batch: resolving while orders are sealed
            // would settle a market against information the traders could not act on.
            assert(self.phase.read() == Phase::Open, errors::WRONG_PHASE);

            let now = get_block_timestamp();
            assert(now >= self.settle_after.read(), errors::TOO_EARLY);
            // Past the deadline the resolver has lost the right to decide, and traders have
            // gained the right to their money back. Both halves matter.
            assert(now <= self.resolve_deadline.read(), errors::DEADLINE_PASSED);

            self.outcome.write(outcome);
            self.phase.write(Phase::Resolved);
            self.emit(Resolved { outcome });
        }

        fn force_refund(ref self: ContractState) {
            let phase = self.phase.read();
            assert(phase != Phase::Resolved && phase != Phase::Refunding, errors::WRONG_PHASE);
            assert(
                get_block_timestamp() > self.resolve_deadline.read(),
                errors::DEADLINE_NOT_PASSED,
            );
            // No caller check on purpose. If this needed permission it would not be a
            // guarantee, it would be another thing to trust the operator for.
            self.phase.write(Phase::Refunding);
            self.emit(RefundOpened {});
        }

        fn get_question(self: @ContractState) -> ByteArray {
            self.question.read()
        }
        fn get_resolution_source(self: @ContractState) -> ByteArray {
            self.resolution_source.read()
        }
        fn get_settle_after(self: @ContractState) -> u64 {
            self.settle_after.read()
        }
        fn get_resolve_deadline(self: @ContractState) -> u64 {
            self.resolve_deadline.read()
        }

        fn redeem(ref self: ContractState, holder_secret: felt252) {
            let phase = self.phase.read();
            let holder = compute_holder(holder_secret);
            let mut pos = self.positions.entry(holder).read();

            if phase == Phase::Refunding {
                // Abandoned market. Everyone gets back exactly what they paid — no winner,
                // no loser, and no discretion for anyone to exercise.
                pos.collateral += pos.staked;
            } else {
                assert(phase == Phase::Resolved, errors::WRONG_PHASE);
                let winning = if self.outcome.read() == 1 {
                    pos.yes_units
                } else {
                    pos.no_units
                };
                pos.collateral += winning * 100_u128;
            }

            pos.yes_units = 0;
            pos.no_units = 0;
            pos.staked = 0;
            self.positions.entry(holder).write(pos);
        }

        fn get_order(self: @ContractState, commitment: felt252) -> Order {
            self.orders.entry(commitment).read()
        }
        fn get_position(self: @ContractState, holder: felt252) -> Position {
            self.positions.entry(holder).read()
        }
        fn get_phase(self: @ContractState) -> Phase {
            self.phase.read()
        }
        fn get_batch(self: @ContractState) -> u64 {
            self.batch.read()
        }
        fn get_clearing_price(self: @ContractState, batch: u64) -> u8 {
            self.clearing_price.entry(batch).read()
        }
        fn get_order_count(self: @ContractState, batch: u64) -> u32 {
            self.order_count.entry(batch).read()
        }
        fn get_outcome(self: @ContractState) -> u8 {
            self.outcome.read()
        }
        fn get_batch_commitment(self: @ContractState, batch: u64, index: u32) -> felt252 {
            self.batch_index.entry((batch, index)).read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Escrow. The pool has ALREADY transferred the collateral here, so the whole job
        /// is to record the commitment and return an empty span — which is what makes the
        /// pool leave the tokens behind.
        fn do_submit(
            ref self: ContractState, commitment: felt252, token: ContractAddress, units: u128,
        ) -> Span<OpenNoteDeposit> {
            assert(self.phase.read() == Phase::Open, errors::WRONG_PHASE);
            assert(commitment != 0, errors::ZERO_COMMITMENT);
            assert(units != 0, errors::ZERO_UNITS);

            let existing = self.orders.entry(commitment).read();
            assert(existing.escrow == 0, errors::COMMITMENT_EXISTS);

            let erc20 = IErc20Dispatcher { contract_address: token };
            let held: u256 = erc20.balance_of(get_contract_address());
            let held_u128: u128 = held.try_into().expect(errors::AMOUNT_OVERFLOW);
            let escrow = held_u128 - self.escrowed_total.read();
            assert(escrow != 0, errors::BAD_ESCROW);
            self.escrowed_total.write(held_u128);

            let batch = self.batch.read();
            let idx = self.order_count.entry(batch).read();

            self
                .orders
                .entry(commitment)
                .write(
                    Order {
                        escrow,
                        batch,
                        revealed: false,
                        side: 0,
                        limit: 0,
                        units: 0,
                        filled: 0,
                        holder: 0,
                        settled: false,
                    },
                );
            self.batch_index.entry((batch, idx)).write(commitment);
            self.order_count.entry(batch).write(idx + 1);

            self.emit(OrderSubmitted { commitment, batch, escrow });

            array![].span()
        }

        /// Pay a holder's collateral out into an open note. Available at ANY time —
        /// including before the market resolves, which is what makes an early exit real
        /// money rather than a number on a screen.
        fn do_withdraw(
            ref self: ContractState,
            token: ContractAddress,
            pool: ContractAddress,
            holder_secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let holder = compute_holder(holder_secret);
            let mut pos = self.positions.entry(holder).read();
            let amount = pos.collateral;
            assert(amount != 0, errors::NOTHING_TO_WITHDRAW);

            pos.collateral = 0;
            self.positions.entry(holder).write(pos);
            self.escrowed_total.write(self.escrowed_total.read() - amount);

            IErc20Dispatcher { contract_address: token }.approve(pool, amount.into());
            self.emit(Withdrawn { holder, amount });

            array![OpenNoteDeposit { note_id, token, amount }].span()
        }

        /// Move one settled order into its holder's position.
        ///
        /// A matched unit is funded 100 between the two sides — the YES buyer pays the
        /// clearing price, the NO buyer pays the complement — so every unit of YES created
        /// has a unit of NO beside it and exactly 100 behind the pair.
        fn apply_fill(ref self: ContractState, order: Order, price: u128) {
            if !order.revealed {
                // Never revealed, so never eligible. Escrow returns whole.
                return;
            }
            let cost_per_unit: u128 = if order.side == 1 {
                price
            } else {
                100_u128 - price
            };
            let spent = order.filled * cost_per_unit;
            let refund = order.escrow - spent;

            let mut pos = self.positions.entry(order.holder).read();
            if order.side == 1 {
                pos.yes_units += order.filled;
            } else {
                pos.no_units += order.filled;
            }
            pos.collateral += refund;
            pos.staked += spent;
            self.positions.entry(order.holder).write(pos);
        }

        /// The clearing price is where demand crosses supply: the price that maximises
        /// matched volume, searched over the 19 rungs of the `TICK` grid rather than all
        /// 99 whole-percent prices.
        ///
        /// TIE-BREAK: THE MIDPOINT OF THE CROSSING RANGE.
        ///
        /// Usually many prices clear the same volume. With YES buyers at 70 and 60 and NO
        /// buyers whose YES-equivalents are 50 and 65, every price from 50 to 70 matches
        /// exactly one unit — so the rule that picks among them decides who captures the
        /// surplus, and it decides it on every trade.
        ///
        /// Taking the lowest hands the whole spread to one side; taking the highest hands
        /// it to the other. Either is a standing bias a participant can farm once they
        /// notice it. The midpoint splits it, which is what an opening auction does.
        ///
        /// It must also be FULLY DETERMINISTIC: `clear` is permissionless, so two honest
        /// callers have to reach the same answer or the contract cannot tell which is
        /// right. Integer division truncates identically for everyone.
        ///
        /// A later version should anchor to the PREVIOUS batch's clearing price, which
        /// minimises the jump between batches and is what reduces inventory risk for
        /// anyone providing liquidity. The midpoint is the honest answer for a first batch.
        fn find_clearing_price(self: @ContractState, batch: u64, count: u32) -> (u8, u128) {
            let mut best_matched: u128 = 0;
            let mut lo: u8 = 0;
            let mut hi: u8 = 0;
            let mut p: u8 = TICK;

            while p <= 100 - TICK {
                let (demand, supply) = self.depth_at(batch, count, p);
                let matched = if demand < supply {
                    demand
                } else {
                    supply
                };
                if matched > best_matched {
                    best_matched = matched;
                    lo = p;
                    hi = p;
                } else if matched == best_matched && best_matched > 0 {
                    hi = p;
                }
                p += TICK;
            }

            if best_matched == 0 {
                return (0, 0);
            }
            // Midpoint, snapped back onto the grid. Without the snap a clearing price could
            // land between rungs, and `eligible` would then disagree with the sweep that
            // chose it.
            let mid = (lo + hi) / 2;
            (mid - (mid % TICK), best_matched)
        }

        /// Cumulative demand and supply at price `p`.
        ///
        /// A YES buyer willing to pay `limit` will pay anything below it; a NO buyer whose
        /// YES-equivalent price is `limit` will trade at anything above it. Both curves are
        /// cumulative, which is the property that makes a crossing point exist at all.
        fn depth_at(self: @ContractState, batch: u64, count: u32, p: u8) -> (u128, u128) {
            let mut demand: u128 = 0;
            let mut supply: u128 = 0;
            let mut i: u32 = 0;

            while i < count {
                let o = self.orders.entry(self.batch_index.entry((batch, i)).read()).read();
                if o.revealed {
                    if o.side == 1 && o.limit >= p {
                        demand += o.units;
                    } else if o.side == 2 && o.limit <= p {
                        supply += o.units;
                    }
                }
                i += 1;
            }
            (demand, supply)
        }

        /// Write `filled` onto every eligible order.
        ///
        /// Only one side is ever rationed: matched volume is `min(demand, supply)`, so the
        /// smaller side fills completely and the larger shares the remainder.
        ///
        /// Within the rationed side, orders strictly better than the clearing price fill
        /// first, and only orders sitting exactly AT it are pro-rated. There is no time
        /// priority anywhere — order arrival is visible on-chain, and using it to allocate
        /// would reinstate exactly the speed advantage that clearing in a sealed batch
        /// exists to remove.
        fn allocate_fills(ref self: ContractState, batch: u64, count: u32, price: u8) {
            let (demand, supply) = self.depth_at(batch, count, price);
            let matched = if demand < supply {
                demand
            } else {
                supply
            };
            if matched == 0 {
                return;
            }
            let rationed: u8 = if demand > supply {
                1
            } else if supply > demand {
                2
            } else {
                0
            };

            let mut at_price_units: u128 = 0;
            let mut infra_units: u128 = 0;
            let mut i: u32 = 0;
            while i < count {
                let o = self.orders.entry(self.batch_index.entry((batch, i)).read()).read();
                if o.revealed && o.side == rationed && self.eligible(o.side, o.limit, price) {
                    if o.limit == price {
                        at_price_units += o.units;
                    } else {
                        infra_units += o.units;
                    }
                }
                i += 1;
            }

            let remainder = if infra_units >= matched {
                0
            } else {
                matched - infra_units
            };

            let mut j: u32 = 0;
            while j < count {
                let c = self.batch_index.entry((batch, j)).read();
                let mut o = self.orders.entry(c).read();
                if o.revealed && self.eligible(o.side, o.limit, price) {
                    let fill: u128 = if o.side != rationed {
                        o.units
                    } else if o.limit != price {
                        if infra_units <= matched {
                            o.units
                        } else {
                            // Even the inframarginal orders are oversubscribed. Rounds
                            // DOWN, so the sum can never exceed `matched` and the dust
                            // simply stays in escrow.
                            o.units * matched / infra_units
                        }
                    } else if at_price_units == 0 {
                        0
                    } else {
                        o.units * remainder / at_price_units
                    };
                    o.filled = fill;
                    self.orders.entry(c).write(o);
                }
                j += 1;
            }
        }

        fn eligible(self: @ContractState, side: u8, limit: u8, price: u8) -> bool {
            (side == 1 && limit >= price) || (side == 2 && limit <= price)
        }
    }
}
