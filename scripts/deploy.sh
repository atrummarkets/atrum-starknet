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

# ALWAYS build the release profile before declaring. `scarb build` writes `dev`, while
# declare reads `release` -- so a plain build leaves a stale release artifact and you
# declare code you are not looking at. That has bitten this project twice: once deploying a
# single-batch contract after adding multi-batch, once deploying a 3-argument constructor
# after adding the question. Both presented as unrelated runtime errors.
echo "==> building (release, the profile declare actually reads)"
scarb --profile release build

echo "==> constructor the artifact ACTUALLY has:"
python3 - <<'PYEOF'
import json, glob
f = glob.glob("target/release/*_AtrumAuction.contract_class.json")[0]
d = json.load(open(f))
abi = d["abi"] if isinstance(d["abi"], list) else json.loads(d["abi"])
for e in abi:
    if e.get("type") == "constructor":
        for i in e["inputs"]:
            print(f"     {i['name']:20} {i['type'].split('::')[-1]}")
PYEOF

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
