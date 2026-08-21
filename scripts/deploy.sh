#!/usr/bin/env bash
#
# Declare the auction and factory classes, then deploy a factory.
#
#   ./scripts/deploy.sh sepolia
#   ./scripts/deploy.sh mainnet
#
# This does NOT create a market. Markets are created through the factory, permissionlessly,
# by whoever wants one -- see scripts/create-market.sh. Deploying a factory is the operator
# step; creating a market is a user step, and keeping them in separate scripts keeps that
# distinction visible.
#
# DECLARE registers a class hash and is the expensive step; it happens once per code version
# and is idempotent, so re-running it against unchanged code costs nothing. DEPLOY instantiates
# against that class and is cheap, which is why one contract per market is the right shape
# here rather than one contract holding many markets.
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

# ALWAYS build the release profile before declaring. `scarb build` writes `dev`, while
# declare reads `release` -- so a plain build leaves a stale release artifact and you
# declare code you are not looking at. That has bitten this project twice: once deploying a
# single-batch contract after adding multi-batch, once deploying a 3-argument constructor
# after adding the question. Both presented as unrelated runtime errors.
echo "==> building (release, the profile declare actually reads)"
scarb --profile release build

# Print what the artifact on disk actually expects, rather than what this script believes it
# expects. The two drifting apart is the failure mode above, and it is silent.
echo "==> constructors the built artifacts ACTUALLY have:"
python3 - <<'PYEOF'
import json, glob
for name in ("AtrumAuction", "AtrumFactory"):
    matches = glob.glob(f"target/release/*_{name}.contract_class.json")
    if not matches:
        print(f"     {name}: NOT BUILT")
        continue
    d = json.load(open(matches[0]))
    abi = d["abi"] if isinstance(d["abi"], list) else json.loads(d["abi"])
    print(f"     {name}:")
    for e in abi:
        if e.get("type") == "constructor":
            for i in e["inputs"]:
                print(f"       {i['name']:22} {i['type'].split('::')[-1]}")
PYEOF

# `declare` exits non-zero when the class is already declared, which is a success for our
# purposes -- we want the hash either way. So the hash is scraped from combined output and
# the exit status is deliberately not trusted.
declare_class() {
  local name="$1" out hash
  out=$(sncast --profile "$NET" declare --contract-name "$name" 2>&1 || true)
  echo "$out" >&2
  hash=$(echo "$out" | grep -oP '(class_hash|Class hash):\s*\K0x[0-9a-fA-F]+' | tail -1)
  if [[ -z "$hash" ]]; then
    echo "could not determine the class hash for $name -- read the output above" >&2
    return 1
  fi
  echo "$hash"
}

echo "==> declaring AtrumAuction (the class every market will run)"
AUCTION_CLASS=$(declare_class AtrumAuction)
echo "    auction class = $AUCTION_CLASS"

echo "==> declaring AtrumFactory"
FACTORY_CLASS=$(declare_class AtrumFactory)
echo "    factory class = $FACTORY_CLASS"

# The auction class hash goes into the factory's constructor and there is NO SETTER. That is
# the entire security argument for trusting a market you did not deploy: every market from
# this factory runs the same code, so reading one tells you something about the next. A
# repointable factory could start producing drainers and its history would not warn you.
#
# The corollary is that changing the auction means a NEW FACTORY, and the old one keeps
# producing the old class. That is the intended cost, not an oversight.
echo "==> deploying the factory"
echo "    auction class = $AUCTION_CLASS"
echo "    pool          = $POOL"
echo "    token         = $TOKEN"
sncast --profile "$NET" deploy \
  --class-hash "$FACTORY_CLASS" \
  --constructor-calldata "$AUCTION_CLASS" "$POOL" "$TOKEN"

cat <<EOF

Next:
  1. Record the factory address and both class hashes in DEPLOYMENTS.md.
  2. Point the app at it   -> NEXT_PUBLIC_ATRUM_FACTORY in .env.local
  3. Point the keeper at it -> KEEPER_FACTORY (Render dashboard, or repo variables)
  4. Create a market       -> ./scripts/create-market.sh $NET
EOF
