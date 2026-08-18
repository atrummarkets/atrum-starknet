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

/// A batch moves forward only. Orders are accepted in Open, revealed in Revealing, and
/// nothing can be claimed until Resolved — so a trader cannot exit a losing position by
/// claiming early.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum Phase {
    Open,
    Revealing,
    Cleared,
    Resolved,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Order {
    /// Collateral escrowed for this order. Public — STRK20 measures amounts on-chain.
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
    pub claimed: bool,
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
}

/// Domain separator, so an auction commitment can never collide with a hash from another
/// protocol that happens to use the same fields.
pub const COMMITMENT_TAG: felt252 = 'ATRUM_ORDER_COMMITMENT:V1';

/// commitment = Poseidon(TAG, side, limit, units, salt)
///
/// `salt` is what keeps the commitment sealed: side, limit and units are all small and
/// enumerable, so without a high-entropy salt anyone could brute-force the preimage and
/// the order would not be sealed at all.
pub fn compute_commitment(side: u8, limit: u8, units: u128, salt: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(
        [COMMITMENT_TAG, side.into(), limit.into(), units.into(), salt].span(),
    )
}

#[starknet::interface]
pub trait IAtrumAuction<TState> {
    /// Called by the privacy pool via `selector!("privacy_invoke")`.
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
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Open the reveal window. Anyone may call once the batch is due.
    fn close_batch(ref self: TState);
    /// Open the commitment. Anyone may submit a valid reveal — it is self-authenticating.
    fn reveal(ref self: TState, side: u8, limit: u8, units: u128, salt: felt252);
    /// Compute the uniform clearing price. Permissionless.
    fn clear(ref self: TState);
    /// Settle the market. Owner-only for this version; an oracle replaces it later.
    fn resolve(ref self: TState, outcome: u8);

    fn get_order(self: @TState, commitment: felt252) -> Order;
    fn get_phase(self: @TState) -> Phase;
    fn get_batch(self: @TState) -> u64;
    fn get_clearing_price(self: @TState, batch: u64) -> u8;
    fn get_order_count(self: @TState, batch: u64) -> u32;
    fn get_outcome(self: @TState) -> u8;
    /// What `commitment` is owed once the market is resolved.
    fn payout_of(self: @TState, commitment: felt252) -> u128;
}

#[starknet::contract]
pub mod AtrumAuction {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        AuctionOperation, IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit, Order, Phase,
        compute_commitment, errors,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        token: ContractAddress,
        owner: ContractAddress,
        batch: u64,
        phase: Phase,
        /// 0 = unresolved, 1 = YES, 2 = NO.
        outcome: u8,
        /// Collateral this contract is holding on behalf of orders. Tracked explicitly so
        /// `do_submit` can derive a new escrow from the balance delta rather than trusting
        /// a caller-supplied amount, and so a stray token transfer to this address cannot
        /// be mistaken for someone's escrow.
        escrowed_total: u128,
        orders: Map<felt252, Order>,
        /// (batch, index) -> commitment. Needed because clearing has to walk the batch,
        /// and a Map alone cannot be iterated.
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
        Resolved: Resolved,
        Claimed: Claimed,
    }

    /// Deliberately carries no side or limit — those are still sealed at submit time.
    /// `escrow` is public regardless, because the pool measured it on-chain.
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
    struct Resolved {
        outcome: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        #[key]
        commitment: felt252,
        amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        token: ContractAddress,
        owner: ContractAddress,
    ) {
        self.pool.write(pool);
        self.token.write(token);
        self.owner.write(owner);
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
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // Only the pool may drive this contract. Two checks, not one: the caller must
            // be the pool we were constructed against, AND the pool address the wallet
            // substituted must agree with the caller. The second catches a malformed
            // ${poolAddress} placeholder before it can do anything.
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);
            assert(pool_address == pool, errors::BAD_POOL);
            assert(token == self.token.read(), errors::BAD_ESCROW);

            match operation {
                AuctionOperation::Submit => self.do_submit(commitment, token, units),
                AuctionOperation::Claim => self
                    .do_claim(token, pool, units, salt, side, limit, note_id),
            }
        }

        fn close_batch(ref self: ContractState) {
            assert(self.phase.read() == Phase::Open, errors::WRONG_PHASE);
            self.phase.write(Phase::Revealing);
        }

        fn reveal(ref self: ContractState, side: u8, limit: u8, units: u128, salt: felt252) {
            assert(self.phase.read() == Phase::Revealing, errors::WRONG_PHASE);
            assert(side == 1 || side == 2, errors::BAD_SIDE);
            assert(limit >= 1 && limit <= 99, errors::BAD_LIMIT);

            // Self-authenticating: only someone holding the preimage can produce a reveal
            // that hashes to a stored commitment, so this needs no caller check and anyone
            // may relay it.
            let commitment = compute_commitment(side, limit, units, salt);
            let mut order = self.orders.entry(commitment).read();
            assert(order.escrow != 0, errors::COMMITMENT_NOT_FOUND);
            assert(!order.revealed, errors::ALREADY_REVEALED);

            // The escrow must match what this order actually costs at its own limit, or a
            // trader could under-collateralise and walk away from a losing fill.
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

        fn resolve(ref self: ContractState, outcome: u8) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            assert(self.phase.read() == Phase::Cleared, errors::WRONG_PHASE);
            assert(outcome == 1 || outcome == 2, errors::BAD_OUTCOME);
            self.outcome.write(outcome);
            self.phase.write(Phase::Resolved);
            self.emit(Resolved { outcome });
        }

        fn get_order(self: @ContractState, commitment: felt252) -> Order {
            self.orders.entry(commitment).read()
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

        fn payout_of(self: @ContractState, commitment: felt252) -> u128 {
            let order = self.orders.entry(commitment).read();
            if order.escrow == 0 {
                return 0;
            }
            self.compute_payout(order)
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Escrow. The pool has ALREADY transferred the collateral here, so there is
        /// nothing to move — the whole job is to record the commitment and return an
        /// empty span, which is what makes the pool leave the tokens behind.
        fn do_submit(
            ref self: ContractState, commitment: felt252, token: ContractAddress, units: u128,
        ) -> Span<OpenNoteDeposit> {
            assert(self.phase.read() == Phase::Open, errors::WRONG_PHASE);
            assert(commitment != 0, errors::ZERO_COMMITMENT);
            assert(units != 0, errors::ZERO_UNITS);

            let existing = self.orders.entry(commitment).read();
            assert(existing.escrow == 0, errors::COMMITMENT_EXISTS);

            // Trust the measured balance, not a claimed amount. The pool transferred the
            // collateral in this same transaction, and this contract holds nothing between
            // transactions that is not already accounted for, so the delta is the escrow.
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
                        claimed: false,
                    },
                );
            self.batch_index.entry((batch, idx)).write(commitment);
            self.order_count.entry(batch).write(idx + 1);

            self.emit(OrderSubmitted { commitment, batch, escrow });

            // Empty span: no note is credited, so the tokens stay here as escrow.
            array![].span()
        }

        /// Pay out. Re-derives the commitment from the preimage, so only someone holding
        /// the secret can claim — and the payout lands in an open note whose owner the
        /// chain cannot see.
        fn do_claim(
            ref self: ContractState,
            token: ContractAddress,
            pool: ContractAddress,
            units: u128,
            salt: felt252,
            side: u8,
            limit: u8,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(self.phase.read() == Phase::Resolved, errors::WRONG_PHASE);

            let commitment = compute_commitment(side, limit, units, salt);
            let mut order = self.orders.entry(commitment).read();
            assert(order.escrow != 0, errors::COMMITMENT_NOT_FOUND);
            assert(order.revealed, errors::NOT_REVEALED);
            assert(!order.claimed, errors::ALREADY_CLAIMED);

            let amount = self.compute_payout(order);

            order.claimed = true;
            self.orders.entry(commitment).write(order);
            self.escrowed_total.write(self.escrowed_total.read() - amount);

            // Let the pool pull exactly the payout, then tell it which note to credit.
            IErc20Dispatcher { contract_address: token }.approve(pool, amount.into());
            self.emit(Claimed { commitment, amount });

            array![OpenNoteDeposit { note_id, token, amount }].span()
        }

        /// refund + winnings.
        ///
        /// A matched unit is funded 100 between the two sides — the buyer pays the
        /// clearing price, the seller pays the complement — so the winner can be paid
        /// exactly 100 per unit and nothing is created or destroyed.
        fn compute_payout(self: @ContractState, order: Order) -> u128 {
            if !order.revealed {
                // Never revealed, so never eligible to trade. Escrow returns in full.
                return order.escrow;
            }
            let price = self.clearing_price.entry(order.batch).read();
            let cost_per_unit: u128 = if order.side == 1 {
                price.into()
            } else {
                100_u128 - price.into()
            };
            let spent = order.filled * cost_per_unit;
            let refund = order.escrow - spent;

            let outcome = self.outcome.read();
            let won = (outcome == 1 && order.side == 1) || (outcome == 2 && order.side == 2);
            if won {
                refund + order.filled * 100_u128
            } else {
                refund
            }
        }

        /// The clearing price is where demand crosses supply: the price that maximises
        /// matched volume.
        ///
        /// TIE-BREAK: THE MIDPOINT OF THE CROSSING RANGE.
        ///
        /// Usually many prices clear the same volume. With buyers at 70 and 60 and sellers
        /// at 50 and 65, every price from 50 to 70 matches exactly one unit — so the rule
        /// that picks among them decides who captures the surplus, and it decides it on
        /// every trade.
        ///
        /// Taking the lowest hands the entire spread to buyers; taking the highest hands it
        /// to sellers. Either is a standing bias that a participant can farm once they
        /// notice it. The midpoint splits it, which is what an opening auction does and
        /// what a market maker can quote around without having to model the tie-break.
        ///
        /// It must also be FULLY DETERMINISTIC. `clear` is permissionless, so two honest
        /// callers have to reach the same answer or the contract cannot tell which is
        /// right. Integer division truncates, always downward, identically for everyone.
        ///
        /// A later version should anchor to the PREVIOUS batch's clearing price instead —
        /// that minimises the jump between batches, which is what actually reduces
        /// inventory risk for anyone providing liquidity. The midpoint is the honest
        /// answer only for a first batch, where no previous price exists.
        fn find_clearing_price(self: @ContractState, batch: u64, count: u32) -> (u8, u128) {
            let mut best_matched: u128 = 0;
            let mut lo: u8 = 0;
            let mut hi: u8 = 0;
            let mut p: u8 = 1;

            while p <= 99 {
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
                    // Still inside the crossing range, so widen it.
                    hi = p;
                }
                p += 1;
            }

            if best_matched == 0 {
                return (0, 0);
            }
            ((lo + hi) / 2, best_matched)
        }

        /// Cumulative demand and supply at price `p`.
        ///
        /// A buyer willing to pay `limit` will pay anything at or below it; a seller
        /// willing to accept `limit` will accept anything at or above it. Both curves are
        /// therefore cumulative, which is the property that makes a crossing point exist.
        fn depth_at(self: @ContractState, batch: u64, count: u32, p: u8) -> (u128, u128) {
            let mut demand: u128 = 0;
            let mut supply: u128 = 0;
            let mut i: u32 = 0;

            while i < count {
                let c = self.batch_index.entry((batch, i)).read();
                let o = self.orders.entry(c).read();
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
        /// smaller side fills completely and the larger side shares the remainder.
        ///
        /// Within the rationed side, orders strictly better than the clearing price fill
        /// first, and only orders sitting exactly AT the clearing price are pro-rated.
        /// There is no time priority anywhere — order arrival is visible on-chain, and
        /// using it to allocate would reinstate exactly the speed advantage that clearing
        /// in a sealed batch exists to remove.
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
            // 1 = buyers rationed, 2 = sellers rationed, 0 = neither.
            let rationed: u8 = if demand > supply {
                1
            } else if supply > demand {
                2
            } else {
                0
            };

            // Units on the rationed side sitting exactly at the clearing price.
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
                        // Unrationed side fills completely.
                        o.units
                    } else if o.limit != price {
                        // Strictly better than clearing: fills ahead of the margin.
                        if infra_units <= matched {
                            o.units
                        } else {
                            // Even the inframarginal orders are oversubscribed. Pro-rate
                            // them too. Rounds DOWN, so the sum can never exceed `matched`
                            // and the dust simply stays in escrow.
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
