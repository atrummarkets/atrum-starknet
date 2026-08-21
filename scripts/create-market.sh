#!/usr/bin/env bash
#
# Create a market through the factory.
#
#   ./scripts/create-market.sh sepolia \
#     "Will ETH close above 3000 USD on 30 Sep 2026 00:00 UTC?" \
#     "Coinbase ETH-USD daily close, 00:00 UTC" \
#     2026-09-30T00:00:00Z \
#     2026-10-03T00:00:00Z \
#     3600
#
# Creation is permissionless: this script has no privileges the caller does not already have,
# and the caller becomes the resolver of their own market. What stops that being a rug is that
# the question and resolution source are fixed at creation, the outcome can only be published
# inside a stated window, and once that window passes ANYONE can refund every holder. A
# creator can be wrong. They cannot steal, and they cannot touch another market.
set -euo pipefail

NET="${1:?usage: $0 <sepolia|mainnet> <question> <source> <settle-after> <resolve-deadline> [reveal-window-seconds]}"
QUESTION="${2:?a market with no question is an auction on abstract tokens}"
SOURCE="${3:?state where the answer will be read from, before anyone bets on it}"
SETTLE_AFTER="${4:?when the event has happened, ISO 8601 or unix seconds}"
RESOLVE_DEADLINE="${5:?when the resolver loses the right to decide, ISO 8601 or unix seconds}"

# How long bidders get to reveal after a round closes, in seconds.
#
# THIS IS THE MOST CONSEQUENTIAL NUMBER HERE, and it is fixed forever at creation.
#
# `clear` refuses until it has elapsed, so it is the guarantee a bidder gets that their sealed
# order will not be dropped from the auction while they still intended to reveal it. Too short
# and honest bidders are excluded by ordinary latency -- a phone that locked, a wallet that
# took a moment. Too long and the market is sluggish.
#
# An hour is the default because reveals are a human action, not an automated one: the bettor's
# own secret is required, so nothing can reveal on their behalf. The contract enforces only a
# 60-second floor, which exists to block the degenerate case rather than to recommend anything
# near it.
REVEAL_WINDOW="${6:-3600}"

# Resolved BEFORE the cd, and absolutely: the helper below is referenced after we have moved
# into cairo/, where a path relative to $0 no longer points at scripts/.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../cairo"

FACTORY="${STRK20_FACTORY:?set STRK20_FACTORY to the factory address (see DEPLOYMENTS.md)}"

# Accept ISO 8601 or raw unix seconds, so the command reads like the market it creates rather
# than like a row of epoch integers nobody can check by eye.
to_unix() {
  if [[ "$1" =~ ^[0-9]+$ ]]; then echo "$1"; else date -u -d "$1" +%s; fi
}
SETTLE_UNIX=$(to_unix "$SETTLE_AFTER")
DEADLINE_UNIX=$(to_unix "$RESOLVE_DEADLINE")

if (( DEADLINE_UNIX <= SETTLE_UNIX )); then
  echo "the resolve window has to exist: deadline must be after settle-after" >&2
  exit 1
fi
if (( REVEAL_WINDOW < 60 || REVEAL_WINDOW > 604800 )); then
  echo "reveal window must be between 60 and 604800 seconds (the contract enforces this)" >&2
  exit 1
fi

# ByteArray is not one felt. Serialising it by hand is how the calldata ends up subtly wrong
# in a way that surfaces as an unrelated error, so it goes through the same helper the tests
# and the app use.
QUESTION_CALLDATA=$(python3 "$SCRIPT_DIR/bytearray.py" "$QUESTION")
SOURCE_CALLDATA=$(python3 "$SCRIPT_DIR/bytearray.py" "$SOURCE")

# Any felt works; it only has to differ from the caller's previous salts. The factory deploys
# with `deploy_from_zero: false`, so the deployer address is mixed in -- two creators picking
# the same salt get different addresses instead of one of them reverting on a collision they
# could not see coming.
#
# A felt, not a label: calldata is numbers, and a word passed here reaches sncast as something
# it cannot parse. Defaults to the current second, which is unique enough per caller.
SALT="${STRK20_SALT:-$(date +%s)}"
if [[ ! "$SALT" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]]; then
  echo "STRK20_SALT must be a felt (decimal or 0x-hex), not '$SALT'" >&2
  exit 1
fi

echo "==> creating a market on $NET"
echo "    question        $QUESTION"
echo "    source          $SOURCE"
echo "    settles after   $(date -u -d "@$SETTLE_UNIX")"
echo "    resolve by      $(date -u -d "@$DEADLINE_UNIX")"
echo "    reveal window   ${REVEAL_WINDOW}s  ($((REVEAL_WINDOW / 60)) min to reveal, enforced on-chain)"
echo "    factory         $FACTORY"
echo

# shellcheck disable=SC2086
sncast --profile "$NET" invoke \
  --contract-address "$FACTORY" \
  --function create_market \
  --calldata $QUESTION_CALLDATA $SOURCE_CALLDATA \
             "$SETTLE_UNIX" "$DEADLINE_UNIX" "$REVEAL_WINDOW" "$SALT"

cat <<EOF

The market is in the factory's on-chain index, so the app will list it without a redeploy.
Add it to DEPLOYMENTS.md so the history stays legible.
EOF
