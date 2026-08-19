//! Cross-implementation hash check.
//!
//! The browser computes the commitment; the contract recomputes it at reveal. If the two
//! disagree by so much as a padding rule, the order can NEVER be revealed and its escrow is
//! stranded — with no error message pointing at the cause, because both sides look correct
//! in isolation.
//!
//! So the Cairo values are printed here and asserted against the JavaScript in
//! `scripts/check-hashing.mjs`. Neither side is trusted; they are compared.
use atrum_auction::{compute_commitment, compute_holder};

#[test]
fn print_reference_hashes() {
    let holder = compute_holder(1);
    println!("holder(1)={}", holder);

    let c = compute_commitment(holder, 1, 60, 1, 12345);
    println!("commitment(holder(1),side=1,limit=60,units=1,salt=12345)={}", c);

    let holder2 = compute_holder(0x1234567890abcdef);
    println!("holder(0x1234567890abcdef)={}", holder2);

    let c2 = compute_commitment(holder2, 2, 35, 1000000000000000000, 0xdeadbeef);
    println!("commitment(h2,side=2,limit=35,units=1e18,salt=0xdeadbeef)={}", c2);
}
