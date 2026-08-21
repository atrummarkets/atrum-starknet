//! Tests for the sealed-bid batch auction.
//!
//! Properties, in order of how badly a bug would hurt:
//!
//!   1. SOLVENCY   -- every matched unit is funded exactly 100 between the two sides, and
//!                    exactly 100 comes back out. A break creates collateral from nothing.
//!   2. ESCROW     -- submit returns an EMPTY deposit span. If it returned a deposit the
//!                    pool would pull the collateral straight back and nothing would back
//!                    the order.
//!   3. EARLY EXIT -- a position bought in one batch can be cashed out in a later one,
//!                    BEFORE the event resolves. This is the claim the product is sold on,
//!                    so it gets a test that fails loudly if it stops being true.
//!   4. CLEARING   -- the price maximises matched volume; allocation respects price
//!                    priority and pro-rates only at the margin.

use atrum_auction::{
    AuctionOperation, IAtrumAuctionDispatcher, IAtrumAuctionDispatcherTrait, UNIT_SCALE,
    compute_commitment, compute_holder,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use super::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

fn POOL() -> ContractAddress {
    0x9001.try_into().unwrap()
}
fn OWNER() -> ContractAddress {
    0x9002.try_into().unwrap()
}

/// Price points -> token base units. The contract's arithmetic is in points; escrow arrives
/// as a real amount. Tests state amounts in points and scale at the boundary, so the numbers
/// stay readable and the scale is still exercised.
fn pts(n: u128) -> u128 {
    n * UNIT_SCALE
}

/// The event settles at t=1000, and the resolver has until t=2000 to say so. After that
/// anyone can open refunds.
const SETTLE_AFTER: u64 = 1000;
const RESOLVE_DEADLINE: u64 = 2000;

#[derive(Copy, Drop)]
struct Ctx {
    auction: IAtrumAuctionDispatcher,
    token: IMockErc20Dispatcher,
    addr: ContractAddress,
}

fn setup() -> Ctx {
    let erc20_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();

    let auction_class = declare("AtrumAuction").unwrap().contract_class();
    let mut args: Array<felt252> = array![];
    args.append(POOL().into());
    args.append(token_addr.into());
    args.append(OWNER().into());
    // A real question and a real resolution source: the contract refuses to deploy without
    // them, which is the point.
    let q: ByteArray = "Will it rain in Delhi on 1 Sep 2026?";
    let src: ByteArray = "IMD official daily rainfall record for Safdarjung station";
    q.serialize(ref args);
    src.serialize(ref args);
    args.append(SETTLE_AFTER.into());
    args.append(RESOLVE_DEADLINE.into());
    let (auction_addr, _) = auction_class.deploy(@args).unwrap();

    Ctx {
        auction: IAtrumAuctionDispatcher { contract_address: auction_addr },
        token: IMockErc20Dispatcher { contract_address: token_addr },
        addr: auction_addr,
    }
}

/// Simulates the pool: transfer collateral to the helper, THEN call privacy_invoke.
/// Order matters -- the contract derives escrow from the balance delta, so calling invoke
/// first would test a sequence the pool never produces.
fn submit(
    c: Ctx, running: u256, escrow_points: u128, holder_secret: felt252, side: u8, limit: u8,
    units: u128, salt: felt252,
) -> (felt252, u256) {
    let new_balance = running + pts(escrow_points).into();
    c.token.set_balance(c.addr, new_balance);

    let holder = compute_holder(holder_secret);
    let commitment = compute_commitment(holder, side, limit, units, salt);

    start_cheat_caller_address(c.auction.contract_address, POOL());
    let deposits = c
        .auction
        .privacy_invoke(
            AuctionOperation::Submit,
            commitment,
            c.token.contract_address,
            POOL(),
            units,
            0,
            0,
            0,
            0,
            0,
        );
    stop_cheat_caller_address(c.auction.contract_address);

    assert(deposits.len() == 0, 'submit must return empty span');
    (commitment, new_balance)
}

#[test]
fn submit_escrows_and_returns_no_deposits() {
    let c = setup();
    let (cm, _) = submit(c, 0, 60, 'alice', 1, 60, 1, 'a1');
    let o = c.auction.get_order(cm);
    assert(o.escrow == pts(60), 'escrow recorded');
    assert(!o.revealed, 'not revealed yet');
    assert(c.auction.get_order_count(0) == 1, 'one order in batch 0');
}

#[test]
fn escrow_is_the_balance_delta_not_the_running_total() {
    let c = setup();
    let (c1, bal) = submit(c, 0, 55, 'alice', 1, 55, 1, 'a1');
    let (c2, _) = submit(c, bal, 30, 'bob', 1, 30, 1, 'b1');
    assert(c.auction.get_order(c1).escrow == pts(55), 'first is 55');
    assert(c.auction.get_order(c2).escrow == pts(30), 'second is the delta');
}

#[test]
fn clearing_price_is_the_midpoint_of_the_crossing_range() {
    let c = setup();
    let mut bal: u256 = 0;
    // YES buyers at 70 and 60.
    let (b70, nb) = submit(c, bal, 70, 'alice', 1, 70, 1, 'a70');
    bal = nb;
    let (b60, nb) = submit(c, bal, 60, 'bob', 1, 60, 1, 'b60');
    bal = nb;
    // NO buyers, quoted as YES-equivalents 50 and 65 -> escrow 50 and 35.
    let (s50, nb) = submit(c, bal, 50, 'carol', 2, 50, 1, 'c50');
    bal = nb;
    let (s65, _) = submit(c, bal, 35, 'dave', 2, 65, 1, 'd65');

    c.auction.close_batch();
    c.auction.reveal('alice', 1, 70, 1, 'a70');
    c.auction.reveal('bob', 1, 60, 1, 'b60');
    c.auction.reveal('carol', 2, 50, 1, 'c50');
    c.auction.reveal('dave', 2, 65, 1, 'd65');
    c.auction.clear();

    // Below 50 no NO buyer trades; above 70 no YES buyer does. In between exactly one unit
    // always crosses, so the range is [50, 70] and the midpoint is 60.
    assert(c.auction.get_clearing_price(0) == 60, 'midpoint of [50,70] is 60');
    assert(c.auction.get_order(s50).filled == 1, 's50 fills');
    assert(c.auction.get_order(s65).filled == 0, 's65 not eligible');
    assert(c.auction.get_order(b70).filled == 1, 'b70 fills first');
    assert(c.auction.get_order(b60).filled == 0, 'b60 rationed out');
}

/// THE CLAIM THE PRODUCT IS SOLD ON.
///
/// Alice buys YES in batch 0. In batch 1 she buys the other side. One YES plus one NO is a
/// complete set worth exactly 100 whichever way the event goes, so she merges and takes
/// real collateral out -- with the market still unresolved and nobody's permission needed.
#[test]
fn position_can_be_cashed_out_before_the_market_resolves() {
    let c = setup();
    let alice = compute_holder('alice');
    let mut bal: u256 = 0;

    // --- batch 0: alice buys YES at 60, bob takes the other side ---
    let (_, nb) = submit(c, bal, 60, 'alice', 1, 60, 1, 'a-b0');
    bal = nb;
    let (_, nb) = submit(c, bal, 40, 'bob', 2, 60, 1, 'b-b0');
    bal = nb;

    c.auction.close_batch();
    c.auction.reveal('alice', 1, 60, 1, 'a-b0');
    c.auction.reveal('bob', 2, 60, 1, 'b-b0');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    assert(c.auction.get_batch() == 1, 'batch advanced');
    let p = c.auction.get_position(alice);
    assert(p.yes_units == 1, 'alice holds 1 YES');
    assert(p.no_units == 0, 'and no NO yet');

    // --- batch 1: alice buys NO at a YES-equivalent of 70, carol takes the other side ---
    let (_, nb) = submit(c, bal, 30, 'alice', 2, 70, 1, 'a-b1');
    bal = nb;
    let (_, _) = submit(c, bal, 70, 'carol', 1, 70, 1, 'c-b1');

    c.auction.close_batch();
    c.auction.reveal('alice', 2, 70, 1, 'a-b1');
    c.auction.reveal('carol', 1, 70, 1, 'c-b1');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    let p = c.auction.get_position(alice);
    assert(p.yes_units == 1 && p.no_units == 1, 'alice holds a complete set');

    // --- exit, with the market STILL UNRESOLVED ---
    assert(c.auction.get_outcome() == 0, 'market is unresolved');
    c.auction.merge('alice', 1);

    let p = c.auction.get_position(alice);
    assert(p.yes_units == 0 && p.no_units == 0, 'set consumed');
    // She paid 60 for the YES in batch 0 and 30 for the NO in batch 1 -- 90 in, across
    // two batches. The complete set merges for exactly 100.
    //
    // So she leaves with 100 against 90 spent: a 10-point gain, realised while the market
    // is still open and nobody knows the outcome. That is what selling before resolution
    // means, and it is why this is a market rather than a pool.
    assert(p.collateral == pts(100), 'merged set pays 100');
}

#[test]
fn solvency_every_matched_unit_is_funded_exactly_100() {
    let c = setup();
    let alice = compute_holder('alice');
    let bob = compute_holder('bob');

    let (_, bal) = submit(c, 0, 70, 'alice', 1, 70, 1, 'ax');
    let (_, _) = submit(c, bal, 40, 'bob', 2, 60, 1, 'bx');
    let total_escrow: u128 = pts(70 + 40);

    c.auction.close_batch();
    c.auction.reveal('alice', 1, 70, 1, 'ax');
    c.auction.reveal('bob', 2, 60, 1, 'bx');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    start_cheat_block_timestamp_global(1500); // inside the resolve window
    start_cheat_caller_address(c.auction.contract_address, OWNER());
    c.auction.resolve(1); // YES wins
    stop_cheat_caller_address(c.auction.contract_address);

    c.auction.redeem('alice');
    c.auction.redeem('bob');

    let pa = c.auction.get_position(alice);
    let pb = c.auction.get_position(bob);
    let paid = pa.collateral + pb.collateral;

    assert(paid <= total_escrow, 'payouts exceed escrow');
    // Cleared at 65 (midpoint of [60,70]). Alice paid 65 and holds the winning unit:
    // refund 5 + payout 100 = 105. Bob paid 35 of his 40: refund 5, loses the unit.
    assert(pa.collateral == pts(105), 'winner takes 100 plus refund');
    assert(pb.collateral == pts(5), 'loser keeps only the refund');
    assert(paid == pts(110), 'in equals out');
}

#[test]
fn withdrawing_pays_into_an_open_note_and_zeroes_the_balance() {
    let c = setup();
    let alice = compute_holder('alice');
    let (_, bal) = submit(c, 0, 60, 'alice', 1, 60, 1, 'a1');
    let (_, _) = submit(c, bal, 40, 'bob', 2, 60, 1, 'b1');

    c.auction.close_batch();
    c.auction.reveal('alice', 1, 60, 1, 'a1');
    c.auction.reveal('bob', 2, 60, 1, 'b1');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    start_cheat_block_timestamp_global(1500);
    start_cheat_caller_address(c.auction.contract_address, OWNER());
    c.auction.resolve(1);
    stop_cheat_caller_address(c.auction.contract_address);
    c.auction.redeem('alice');

    let owed = c.auction.get_position(alice).collateral;
    assert(owed == pts(100), 'alice is owed 100');

    start_cheat_caller_address(c.auction.contract_address, POOL());
    let deposits = c
        .auction
        .privacy_invoke(
            AuctionOperation::Claim,
            0,
            c.token.contract_address,
            POOL(),
            0,
            0,
            0,
            0,
            'alice',
            'note-1',
        );
    stop_cheat_caller_address(c.auction.contract_address);

    assert(deposits.len() == 1, 'one deposit instruction');
    let d = *deposits.at(0);
    assert(d.amount == pts(100), 'credits the full balance');
    assert(d.note_id == 'note-1', 'into the open note');
    assert(c.auction.get_position(alice).collateral == 0, 'balance zeroed');
}

#[test]
#[should_panic(expected: 'BAD_ESCROW')]
fn reveal_rejects_under_collateralised_order() {
    let c = setup();
    let (_, _) = submit(c, 0, 10, 'cheat', 1, 70, 1, 'x');
    c.auction.close_batch();
    c.auction.reveal('cheat', 1, 70, 1, 'x');
}

#[test]
#[should_panic(expected: 'NOT_ENOUGH_UNITS')]
fn cannot_merge_a_set_you_do_not_hold() {
    let c = setup();
    c.auction.merge('nobody', 1);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn only_the_pool_may_invoke() {
    let c = setup();
    c
        .auction
        .privacy_invoke(
            AuctionOperation::Submit, 'x', c.token.contract_address, POOL(), 1, 0, 0, 0, 0, 0,
        );
}

/// THE TRUST BOUND.
///
/// A resolver who goes quiet must not be able to strand the market. Past the deadline
/// anyone can open refunds, and every holder gets back exactly what they paid — no winner,
/// no loser, no discretion.
#[test]
fn an_abandoned_market_refunds_everyone_at_cost() {
    let c = setup();
    let alice = compute_holder('alice');
    let bob = compute_holder('bob');

    let (_, bal) = submit(c, 0, 70, 'alice', 1, 70, 1, 'ax');
    let (_, _) = submit(c, bal, 40, 'bob', 2, 60, 1, 'bx');

    c.auction.close_batch();
    c.auction.reveal('alice', 1, 70, 1, 'ax');
    c.auction.reveal('bob', 2, 60, 1, 'bx');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    // Cleared at 65: alice paid 65 of her 70, bob paid 35 of his 40.
    assert(c.auction.get_position(alice).staked == pts(65), 'alice staked 65');
    assert(c.auction.get_position(bob).staked == pts(35), 'bob staked 35');

    // The resolver never resolves. Deadline passes.
    start_cheat_block_timestamp_global(RESOLVE_DEADLINE + 1);
    // Anyone. No permission, no owner cheat — that is the guarantee.
    c.auction.force_refund();

    c.auction.redeem('alice');
    c.auction.redeem('bob');

    let pa = c.auction.get_position(alice);
    let pb = c.auction.get_position(bob);
    // 5 refunded at settle + 65 staked back = 70, exactly what she put in.
    assert(pa.collateral == pts(70), 'alice made whole');
    assert(pb.collateral == pts(40), 'bob made whole');
    assert(pa.collateral + pb.collateral == pts(110), 'nothing created or lost');
}

#[test]
#[should_panic(expected: 'TOO_EARLY')]
fn cannot_resolve_before_the_event_has_happened() {
    let c = setup();
    let (_, bal) = submit(c, 0, 70, 'alice', 1, 70, 1, 'ax');
    let (_, _) = submit(c, bal, 40, 'bob', 2, 60, 1, 'bx');
    c.auction.close_batch();
    c.auction.reveal('alice', 1, 70, 1, 'ax');
    c.auction.reveal('bob', 2, 60, 1, 'bx');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    start_cheat_block_timestamp_global(SETTLE_AFTER - 1);
    start_cheat_caller_address(c.auction.contract_address, OWNER());
    c.auction.resolve(1);
}

#[test]
#[should_panic(expected: 'DEADLINE_PASSED')]
fn resolver_loses_the_right_to_decide_after_the_deadline() {
    let c = setup();
    let (_, bal) = submit(c, 0, 70, 'alice', 1, 70, 1, 'ax');
    let (_, _) = submit(c, bal, 40, 'bob', 2, 60, 1, 'bx');
    c.auction.close_batch();
    c.auction.reveal('alice', 1, 70, 1, 'ax');
    c.auction.reveal('bob', 2, 60, 1, 'bx');
    c.auction.clear();
    c.auction.settle_batch(array![]);

    start_cheat_block_timestamp_global(RESOLVE_DEADLINE + 1);
    start_cheat_caller_address(c.auction.contract_address, OWNER());
    c.auction.resolve(1);
}

/// The constructor refuses a market with no question.
///
/// Tested where the rule LIVES rather than through the factory: a failed `deploy_syscall`
/// surfaces as a VM exception that `should_panic` cannot catch, whereas deploying directly
/// hands back the panic data to inspect. Same rule, testable form.
#[test]
fn a_market_with_no_question_cannot_be_deployed() {
    let erc20_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();
    let auction_class = declare("AtrumAuction").unwrap().contract_class();

    let mut args: Array<felt252> = array![];
    args.append(POOL().into());
    args.append(token_addr.into());
    args.append(OWNER().into());
    let empty: ByteArray = "";
    let src: ByteArray = "Some source";
    empty.serialize(ref args);
    src.serialize(ref args);
    args.append(SETTLE_AFTER.into());
    args.append(RESOLVE_DEADLINE.into());

    match auction_class.deploy(@args) {
        Result::Ok(_) => panic!("a market with no question should not deploy"),
        Result::Err(panic_data) => {
            // A market with no question is an auction on abstract tokens. The contract says
            // so itself rather than leaving a UI to enforce it.
            assert(*panic_data.at(0) == 'EMPTY_QUESTION', 'wrong reason');
        },
    }
}
