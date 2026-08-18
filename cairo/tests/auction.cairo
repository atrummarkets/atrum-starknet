//! Tests for the sealed-bid auction helper.
//!
//! The three properties worth proving, in order of how badly a bug would hurt:
//!
//!   1. SOLVENCY  -- total paid out never exceeds total escrowed. A break here creates
//!                   collateral from nothing and the pool eats the difference.
//!   2. ESCROW    -- submit must return an EMPTY deposit span. If it ever returned a
//!                   deposit, the pool would pull the collateral straight back out and
//!                   there would be nothing behind the order.
//!   3. CLEARING  -- the price maximises matched volume, and allocation gives strict
//!                   price priority with pro-rata only at the margin.

use atrum_auction::{
    AuctionOperation, IAtrumAuctionDispatcher, IAtrumAuctionDispatcherTrait, compute_commitment,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use super::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

fn POOL() -> ContractAddress {
    0x9001.try_into().unwrap()
}
fn OWNER() -> ContractAddress {
    0x9002.try_into().unwrap()
}

/// Deploys the token and the auction, and returns both plus the auction address.
fn setup() -> (IAtrumAuctionDispatcher, IMockErc20Dispatcher, ContractAddress) {
    let erc20_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();

    let auction_class = declare("AtrumAuction").unwrap().contract_class();
    let mut args: Array<felt252> = array![];
    args.append(POOL().into());
    args.append(token_addr.into());
    args.append(OWNER().into());
    let (auction_addr, _) = auction_class.deploy(@args).unwrap();

    (
        IAtrumAuctionDispatcher { contract_address: auction_addr },
        IMockErc20Dispatcher { contract_address: token_addr },
        auction_addr,
    )
}

/// Simulates the pool: it transfers collateral to the helper, THEN calls privacy_invoke.
/// Order matters -- the contract derives the escrow from the balance delta, so a test that
/// called invoke first would be testing a sequence the pool never produces.
fn submit(
    auction: IAtrumAuctionDispatcher,
    token: IMockErc20Dispatcher,
    auction_addr: ContractAddress,
    running_balance: u256,
    escrow: u128,
    side: u8,
    limit: u8,
    units: u128,
    salt: felt252,
) -> (felt252, u256) {
    let new_balance = running_balance + escrow.into();
    token.set_balance(auction_addr, new_balance);

    let commitment = compute_commitment(side, limit, units, salt);
    start_cheat_caller_address(auction.contract_address, POOL());
    let deposits = auction
        .privacy_invoke(
            AuctionOperation::Submit,
            commitment,
            token.contract_address,
            POOL(),
            units,
            0,
            0,
            0,
            0,
        );
    stop_cheat_caller_address(auction.contract_address);

    // PROPERTY 2. An empty span is what leaves the tokens here.
    assert(deposits.len() == 0, 'submit must return empty span');

    (commitment, new_balance)
}

#[test]
fn submit_escrows_and_returns_no_deposits() {
    let (auction, token, addr) = setup();
    let (c, _) = submit(auction, token, addr, 0, 60, 1, 60, 1, 'salt-a');

    let order = auction.get_order(c);
    assert(order.escrow == 60, 'escrow recorded');
    assert(!order.revealed, 'not revealed yet');
    assert(auction.get_order_count(0) == 1, 'one order in batch');
}

#[test]
fn clearing_price_is_where_demand_meets_supply() {
    let (auction, token, addr) = setup();
    let mut bal: u256 = 0;

    // Buyers: 1 unit @ 70, 1 unit @ 60. Buyer escrow = units * limit.
    let (b70, nb) = submit(auction, token, addr, bal, 70, 1, 70, 1, 'b70');
    bal = nb;
    let (b60, nb) = submit(auction, token, addr, bal, 60, 1, 60, 1, 'b60');
    bal = nb;
    // Sellers: 1 unit @ 50, 1 unit @ 65. Seller escrow = units * (100 - limit).
    let (s50, nb) = submit(auction, token, addr, bal, 50, 2, 50, 1, 's50');
    bal = nb;
    let (s65, nb) = submit(auction, token, addr, bal, 35, 2, 65, 1, 's65');
    bal = nb;

    auction.close_batch();
    auction.reveal(1, 70, 1, 'b70');
    auction.reveal(1, 60, 1, 'b60');
    auction.reveal(2, 50, 1, 's50');
    auction.reveal(2, 65, 1, 's65');
    auction.clear();

    // Every price from 50 to 70 matches exactly one unit:
    //   below 50 no seller will trade, so supply is 0
    //   above 70 no buyer will trade, so demand is 0
    //   in between, one unit always crosses
    // The midpoint of [50, 70] is 60. Picking the lowest would hand the whole 20-point
    // spread to the buyer, and the highest would hand it to the seller.
    let price = auction.get_clearing_price(0);
    assert(price == 60, 'clears at midpoint 60');

    // Buyers both eligible at 60, sellers rationed to 1 -- so the seller at 50 fills
    // (strictly better than clearing) and the seller at 65 is not eligible at all.
    assert(auction.get_order(s50).filled == 1, 's50 fills');
    assert(auction.get_order(s65).filled == 0, 's65 out of the money');
    // Buyers are the long side: 2 units of demand against 1 of supply, so they are
    // rationed. The 70 is strictly better than clearing and takes it.
    assert(auction.get_order(b70).filled == 1, 'b70 fills first');
    assert(auction.get_order(b60).filled == 0, 'b60 at margin gets rest');
}

#[test]
fn solvency_payouts_never_exceed_escrow() {
    let (auction, token, addr) = setup();
    let mut bal: u256 = 0;

    let (b, nb) = submit(auction, token, addr, bal, 70, 1, 70, 1, 'bx');
    bal = nb;
    let (s, nb) = submit(auction, token, addr, bal, 40, 2, 60, 1, 'sx');
    bal = nb;

    auction.close_batch();
    auction.reveal(1, 70, 1, 'bx');
    auction.reveal(2, 60, 1, 'sx');
    auction.clear();

    start_cheat_caller_address(auction.contract_address, OWNER());
    auction.resolve(1); // YES wins
    stop_cheat_caller_address(auction.contract_address);

    let total_escrow: u128 = 70 + 40;
    let paid = auction.payout_of(b) + auction.payout_of(s);

    // PROPERTY 1. This is the invariant the whole contract exists to preserve.
    assert(paid <= total_escrow, 'payouts exceed escrow');

    // And specifically: a matched unit is funded 100 between the two sides, so the
    // winner takes exactly 100 and the loser keeps only their unspent refund.
    let price: u128 = auction.get_clearing_price(0).into();
    let buyer_refund = 70 - price;
    assert(auction.payout_of(b) == buyer_refund + 100, 'buyer takes the pot');
    assert(auction.payout_of(s) == 40 - (100 - price), 'seller keeps refund only');
}

#[test]
fn escrow_is_the_balance_delta_not_the_running_total() {
    let (auction, token, addr) = setup();
    // Two orders in the same open batch. The second must record 30, not 85 -- the
    // contract derives each escrow from the delta against what it already holds, so a
    // running balance cannot be mistaken for a single enormous order.
    let (c1, bal) = submit(auction, token, addr, 0, 55, 1, 55, 1, 'first');
    let (c2, _) = submit(auction, token, addr, bal, 30, 1, 30, 1, 'second');

    assert(auction.get_order(c1).escrow == 55, 'first escrow is 55');
    assert(auction.get_order(c2).escrow == 30, 'second escrow is the delta');
}

#[test]
fn never_revealed_order_is_refunded_in_full() {
    let (auction, token, addr) = setup();
    let (ghost, bal) = submit(auction, token, addr, 0, 55, 1, 55, 1, 'ghost');
    // A counterparty, so the batch has something to clear.
    let (_, _) = submit(auction, token, addr, bal, 40, 2, 60, 1, 'seller');

    auction.close_batch();
    auction.reveal(2, 60, 1, 'seller');   // only the seller reveals
    auction.clear();

    start_cheat_caller_address(auction.contract_address, OWNER());
    auction.resolve(2);
    stop_cheat_caller_address(auction.contract_address);

    // Never revealed means never eligible to trade, so the escrow comes back whole --
    // regardless of which way the market resolved.
    assert(auction.payout_of(ghost) == 55, 'unrevealed refunded in full');
}

#[test]
#[should_panic(expected: 'BAD_ESCROW')]
fn reveal_rejects_under_collateralised_order() {
    let (auction, token, addr) = setup();
    // Escrows 10 but claims a buy of 1 unit at limit 70, which costs 70.
    let _ = submit(auction, token, addr, 0, 10, 1, 70, 1, 'cheat');
    auction.close_batch();
    auction.reveal(1, 70, 1, 'cheat');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn only_the_pool_may_invoke() {
    let (auction, token, _) = setup();
    auction
        .privacy_invoke(
            AuctionOperation::Submit, 'c', token.contract_address, POOL(), 1, 0, 0, 0, 0,
        );
}
