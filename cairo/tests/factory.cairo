//! Factory tests.
//!
//! Two properties matter here and one of them is the whole point of the contract:
//!
//!   IMMUTABLE CLASS HASH — every market this factory produces runs the same code. If that
//!   could be changed, reading past markets would tell you nothing about the next one.
//!
//!   PERMISSIONLESS CREATION, BOUNDED CREATOR — anyone may create a market and becomes its
//!   resolver. That is safe only because the auction bounds a resolver: committed question,
//!   a resolve window, and a refund anyone can trigger.

use atrum_auction::factory::{IAtrumFactoryDispatcher, IAtrumFactoryDispatcherTrait};
use atrum_auction::{IAtrumAuctionDispatcher, IAtrumAuctionDispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x9001.try_into().unwrap()
}
fn TOKEN() -> ContractAddress {
    0x9003.try_into().unwrap()
}
fn ALICE() -> ContractAddress {
    0xA11CE.try_into().unwrap()
}
fn BOB() -> ContractAddress {
    0xB0B.try_into().unwrap()
}

fn setup() -> IAtrumFactoryDispatcher {
    let auction = declare("AtrumAuction").unwrap().contract_class();
    let factory = declare("AtrumFactory").unwrap().contract_class();
    let (addr, _) = factory
        .deploy(@array![(*auction.class_hash).into(), POOL().into(), TOKEN().into()])
        .unwrap();
    IAtrumFactoryDispatcher { contract_address: addr }
}

#[test]
fn anyone_can_create_a_market_and_becomes_its_resolver() {
    let f = setup();
    assert(f.market_count() == 0, 'starts empty');

    start_cheat_caller_address(f.contract_address, ALICE());
    let m = f
        .create_market(
            "Will it rain in Delhi on 1 Sep 2026?",
            "IMD daily rainfall record, Safdarjung",
            1000,
            2000,
            'salt-1',
        );
    stop_cheat_caller_address(f.contract_address);

    assert(f.market_count() == 1, 'one market');
    let r = f.market_at(0);
    assert(r.address == m, 'address recorded');
    // The CREATOR resolves their own market -- not the factory, not us.
    assert(r.creator == ALICE(), 'creator is the resolver');

    // And the market it deployed is a real, readable market.
    let auction = IAtrumAuctionDispatcher { contract_address: m };
    assert(auction.get_question() == "Will it rain in Delhi on 1 Sep 2026?", 'question stored');
    assert(auction.get_settle_after() == 1000, 'schedule stored');
}

#[test]
fn markets_are_isolated_from_each_other() {
    let f = setup();

    start_cheat_caller_address(f.contract_address, ALICE());
    let a = f.create_market("Question A?", "Source A", 1000, 2000, 'sa');
    stop_cheat_caller_address(f.contract_address);

    start_cheat_caller_address(f.contract_address, BOB());
    let b = f.create_market("Question B?", "Source B", 3000, 4000, 'sb');
    stop_cheat_caller_address(f.contract_address);

    assert(a != b, 'distinct addresses');
    assert(f.market_count() == 2, 'two markets');
    assert(f.market_at(0).creator == ALICE(), 'A belongs to alice');
    assert(f.market_at(1).creator == BOB(), 'B belongs to bob');

    // Separate contracts means separate escrow. A bug in one cannot reach the other's
    // collateral, which is the reason for one-contract-per-market rather than a shared one.
    let qa = IAtrumAuctionDispatcher { contract_address: a }.get_question();
    let qb = IAtrumAuctionDispatcher { contract_address: b }.get_question();
    assert(qa == "Question A?", 'A kept its own question');
    assert(qb == "Question B?", 'B kept its own question');
}

#[test]
fn the_class_hash_is_fixed_at_construction() {
    let f = setup();
    let declared = declare("AtrumAuction").unwrap().contract_class();
    // Every market from this factory runs this exact class, and there is no setter to point
    // it elsewhere. That is the security argument for trusting a market you did not deploy.
    assert(f.auction_class_hash() == *declared.class_hash, 'class hash pinned');
    assert(f.pool() == POOL(), 'pool pinned');
    assert(f.token() == TOKEN(), 'token pinned');
}

#[test]
fn two_creators_can_use_the_same_salt() {
    let f = setup();
    // deploy_from_zero: false mixes the deployer in, so a salt collision between two
    // unrelated creators does not revert for whoever is second.
    start_cheat_caller_address(f.contract_address, ALICE());
    let a = f.create_market("A?", "S", 1000, 2000, 'same');
    stop_cheat_caller_address(f.contract_address);
    start_cheat_caller_address(f.contract_address, BOB());
    let b = f.create_market("B?", "S", 1000, 2000, 'same');
    stop_cheat_caller_address(f.contract_address);
    assert(a != b, 'same salt, different markets');
}

#[test]
#[should_panic(expected: 'OUT_OF_RANGE')]
fn reading_past_the_end_is_an_error_not_a_zero() {
    let f = setup();
    f.market_at(0);
}
