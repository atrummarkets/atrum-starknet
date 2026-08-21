//! The market factory.
//!
//! WHY A FACTORY AND NOT A MULTI-MARKET CONTRACT
//!
//! Starknet separates `DECLARE` (register a class, once) from `DEPLOY` (instantiate), so a
//! new market costs a cheap deploy against a class hash that already exists. Each market then
//! holds its OWN escrow, which means a bug in one cannot reach another market's collateral.
//! A shared contract makes every market as risky as the worst one.
//!
//! WHAT MAKES THIS SAFE TO USE
//!
//! The auction class hash is set at construction and there is NO setter. That is the whole
//! security argument: every market this factory has ever produced, or ever will, runs the
//! same code. A factory that could be repointed at a different class hash would be a factory
//! that could start minting drainers, and no amount of reading past markets would tell you
//! whether the next one is safe.
//!
//! CREATION IS PERMISSIONLESS
//!
//! Anyone can create a market. The creator becomes that market's resolver, which sounds
//! alarming until you notice what bounds it: the auction refuses to deploy without a
//! question and a resolution source, refuses to resolve outside a published window, and lets
//! ANYONE refund every holder once the deadline passes. So a bad-faith creator can publish a
//! wrong outcome on their own market, and cannot steal, cannot freeze funds, and cannot touch
//! any other market.
//!
//! Listing is separate from endorsement. This contract indexes what was created; it does not
//! vouch for it, and a UI reading this index should say so.

use starknet::{ClassHash, ContractAddress};

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct MarketRef {
    pub address: ContractAddress,
    pub creator: ContractAddress,
    pub created_at: u64,
    pub settle_after: u64,
}

#[starknet::interface]
pub trait IAtrumFactory<TState> {
    /// Deploy a market. Anyone may call this.
    fn create_market(
        ref self: TState,
        question: ByteArray,
        resolution_source: ByteArray,
        settle_after: u64,
        resolve_deadline: u64,
        reveal_window: u64,
        salt: felt252,
    ) -> ContractAddress;

    fn market_count(self: @TState) -> u32;
    fn market_at(self: @TState, index: u32) -> MarketRef;
    /// The class every market from this factory runs. Immutable.
    fn auction_class_hash(self: @TState) -> ClassHash;
    fn pool(self: @TState) -> ContractAddress;
    fn token(self: @TState) -> ContractAddress;
}

#[starknet::contract]
pub mod AtrumFactory {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::syscalls::deploy_syscall;
    use starknet::{
        ClassHash, ContractAddress, get_block_timestamp, get_caller_address,
    };
    use super::{IAtrumFactory, MarketRef};

    pub mod errors {
        pub const ZERO_CLASS_HASH: felt252 = 'ZERO_CLASS_HASH';
        pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
        pub const OUT_OF_RANGE: felt252 = 'OUT_OF_RANGE';
    }

    #[storage]
    struct Storage {
        /// Written once, in the constructor. No setter anywhere, deliberately.
        auction_class_hash: ClassHash,
        pool: ContractAddress,
        token: ContractAddress,
        count: u32,
        markets: Map<u32, MarketRef>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MarketCreated: MarketCreated,
    }

    #[derive(Drop, starknet::Event)]
    struct MarketCreated {
        #[key]
        market: ContractAddress,
        #[key]
        creator: ContractAddress,
        index: u32,
        settle_after: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        auction_class_hash: ClassHash,
        pool: ContractAddress,
        token: ContractAddress,
    ) {
        assert(auction_class_hash.is_non_zero(), errors::ZERO_CLASS_HASH);
        assert(pool.is_non_zero() && token.is_non_zero(), errors::ZERO_ADDRESS);
        self.auction_class_hash.write(auction_class_hash);
        self.pool.write(pool);
        self.token.write(token);
        self.count.write(0);
    }

    #[abi(embed_v0)]
    pub impl AtrumFactoryImpl of IAtrumFactory<ContractState> {
        fn create_market(
            ref self: ContractState,
            question: ByteArray,
            resolution_source: ByteArray,
            settle_after: u64,
            resolve_deadline: u64,
            reveal_window: u64,
            salt: felt252,
        ) -> ContractAddress {
            let creator = get_caller_address();

            // The auction validates its own arguments -- non-empty question and source, and
            // a resolve window that exists. Re-checking here would be a second place for
            // those rules to drift out of step with the contract that enforces them.
            let mut calldata: Array<felt252> = array![];
            calldata.append(self.pool.read().into());
            calldata.append(self.token.read().into());
            // The CREATOR is the resolver of their own market, not the factory and not us.
            calldata.append(creator.into());
            question.serialize(ref calldata);
            resolution_source.serialize(ref calldata);
            calldata.append(settle_after.into());
            calldata.append(resolve_deadline.into());
            calldata.append(reveal_window.into());

            // `deploy_from_zero: false` mixes the deployer address into the salt, so two
            // creators picking the same salt get different addresses instead of one of them
            // reverting on a collision they cannot see coming.
            let (address, _) = deploy_syscall(
                self.auction_class_hash.read(), salt, calldata.span(), false,
            )
                .unwrap();

            let index = self.count.read();
            self
                .markets
                .entry(index)
                .write(
                    MarketRef {
                        address, creator, created_at: get_block_timestamp(), settle_after,
                    },
                );
            self.count.write(index + 1);

            self.emit(MarketCreated { market: address, creator, index, settle_after });
            address
        }

        fn market_count(self: @ContractState) -> u32 {
            self.count.read()
        }

        fn market_at(self: @ContractState, index: u32) -> MarketRef {
            assert(index < self.count.read(), errors::OUT_OF_RANGE);
            self.markets.entry(index).read()
        }

        fn auction_class_hash(self: @ContractState) -> ClassHash {
            self.auction_class_hash.read()
        }
        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
        fn token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }
    }
}
