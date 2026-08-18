//! Minimal ERC-20 standing in for the collateral token.
//!
//! Only `balance_of` and `approve` exist, because those are the only two the auction
//! touches. A fuller mock would add surface that no test exercises and that could drift
//! from the real token's behaviour without anything noticing.
#[starknet::interface]
pub trait IMockErc20<TState> {
    fn balance_of(self: @TState, account: starknet::ContractAddress) -> u256;
    fn approve(ref self: TState, spender: starknet::ContractAddress, amount: u256) -> bool;
    fn set_balance(ref self: TState, account: starknet::ContractAddress, amount: u256);
    fn allowance_of(
        self: @TState, owner: starknet::ContractAddress, spender: starknet::ContractAddress,
    ) -> u256;
}

#[starknet::contract]
pub mod MockErc20 {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    impl MockImpl of super::IMockErc20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            true
        }
        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.entry(account).write(amount);
        }
        fn allowance_of(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }
    }
}
