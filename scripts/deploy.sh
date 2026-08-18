#!/usr/bin/env bash
#
# Declare and deploy the auction to Starknet.
#
#   ./scripts/deploy.sh sepolia
#   ./scripts/deploy.sh mainnet
#
# DECLARE registers the class hash and is the expensive step -- it happens once per code
# version. DEPLOY instantiates a market against that class and is cheap, which is why one
# contract per market is the right shape here rather than a multi-market contract.
set -euo pipefail

NET="${1:-sepolia}"
cd "$(dirname "$0")/../cairo"

# The STRK20 privacy pool. The auction only ever accepts calls from this address.
case "$NET" in
  sepolia)
    POOL=0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91
    ;;
  mainnet)
    POOL=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
    ;;
  *)
    echo "usage: $0 [sepolia|mainnet]" >&2; exit 1 ;;
esac

# Collateral token. Must be one the pool actually supports, or shielding will fail before
# the auction is ever reached.
TOKEN="${STRK20_TOKEN:?set STRK20_TOKEN to the collateral token address}"
OWNER="${STRK20_OWNER:?set STRK20_OWNER to the address allowed to resolve the market}"

echo "==> building"
scarb build

echo "==> declaring (once per code version; reuses the class hash if unchanged)"
CLASS_HASH=$(sncast --profile "$NET" declare \
  --contract-name AtrumAuction 2>&1 | tee /dev/stderr | grep -oP 'class_hash:\s*\K0x[0-9a-fA-F]+' | tail -1)

echo "==> deploying a market instance"
echo "    pool  = $POOL"
echo "    token = $TOKEN"
echo "    owner = $OWNER"
sncast --profile "$NET" deploy \
  --class-hash "$CLASS_HASH" \
  --constructor-calldata "$POOL" "$TOKEN" "$OWNER"

echo
echo "Record the deployed address in strk20.json under \"contracts\"."
