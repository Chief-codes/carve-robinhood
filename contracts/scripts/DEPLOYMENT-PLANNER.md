# Unsigned deployment planner and read-only verifier

Run these tools from `work/carve-contracts` after the final `forge build`. They use the existing `viem` installation in `outputs/Carve/node_modules`; they do not install packages, load private keys, sign or submit transactions.

## Prepare a nonce-bound unsigned plan

```sh
node scripts/prepare-deployment.mjs \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --estimate-gas \
  --out deployment-plans/unsigned-candidate.json
```

`CARVE_RPC_URL` may supply the RPC URL instead. The output file must not already exist; the tool refuses to overwrite it. RPC operations read the chain, pending wallet nonce and canonical PoolManager code, and optionally simulate the deployment gas. The planner rechecks nonce and artifact freshness before writing its result.

The deployer and platform recipient are both the approved public wallet `0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048`. The output contains exactly two unsigned contract-creation requests:

1. Deploy `CarveContentRegistry` at the sender's observed pending nonce.
2. Deploy `CarveDeployment(registry, platformRecipient, hookSalt)` at the next sender nonce. Its constructor atomically creates the engine, factory and router.

Both requests have zero transaction value. They do not launch a token or purchase curve tokens. Gas still has to be funded. The plan does not claim the wallet balance is sufficient and leaves the final required balance unset.

The coordinator's first child creation is CREATE2 for the engine, consuming coordinator nonce 1. The factory uses coordinator CREATE nonce 2 and the router uses nonce 3. The engine constructor is encoded with the canonical PoolManager and predicted factory. The tool mines a bytes32 salt locally until the engine address's low 14 bits equal exactly `0x2044`.

Each plan includes predicted addresses, complete unsigned request data, constructor inputs, bytecode/template hashes, an engine initcode hash, an identifier binding the plan contents, and approved economics. Any intervening wallet transaction or change to source/compiler output/deployer/constructor inputs requires regenerating the plan and hook salt. Confirm the registry receipt succeeded before submitting the coordinator request through a separately authorized wallet workflow.

The planner rejects stale source hashes, unresolved bytecode and child creation code that differs from code embedded in the coordinator. Keep the exact build artifacts associated with any plan. A later build cannot silently stand in for the originally reviewed bytecode.

### Simulation limits

`--estimate-gas` calls the RPC's actual gas estimator separately for each unsigned request. The simulation temporarily overrides sender balance and nonce. For the second request it also installs the compiled registry runtime at the planned registry address to model the preceding deployment. These overrides do not mutate the chain or provide real funds.

Successful estimates report gas and the current RPC gas-price quote. Multiplying them gives an estimated execution fee at that quote, not a guaranteed future funding requirement. Unsupported state overrides or other RPC failures are recorded as unavailable; there is no guessed substitute. Failed or missing estimates do not become zero. No gas or fee fields are silently inserted into the unsigned requests.

For deterministic offline inspection only:

```sh
node scripts/prepare-deployment.mjs --offline-nonce 0
```

That nonce is explicitly supplied, not observed pending state. The output is labeled offline/unverified and cannot provide gas estimates. Use a fresh RPC-backed plan for the actual wallet workflow.

## Verify the resulting deployment

After separately authorized wallet submission and confirmation, provide the actual two transaction hashes:

```sh
node scripts/verify-deployment.mjs \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --plan deployment-plans/unsigned-candidate.json \
  --registry-tx 0xREGISTRY_TRANSACTION_HASH \
  --coordinator-tx 0xCOORDINATOR_TRANSACTION_HASH
```

The verifier makes read-only calls and checks:

- The saved plan exactly matches the current source-verified build artifacts and approved wallet/configuration.
- Chain 4663, signed transaction chain IDs, senders, nonces, zero values, exact deployment data, successful receipts, created addresses and canonical receipt block hashes.
- The canonical PoolManager runtime hash and the engine's required hook address bits.
- Complete deployed runtime code against the compiler output, masking only compiler-declared immutable slots; separate getter reads verify those immutable values.
- Coordinator registry/engine/factory/router bindings; engine factory/PoolManager/hook/creator-limit bindings; factory registry/platform/engine/locker/economics; router engine/PoolManager; and registry format limits.

Results include an observation block/hash, actual runtime hashes and receipt gas usage/effective price. This verifies a deployment's identity and immutable configuration. It does not establish an external audit, future gas prices or all possible contract behavior.

## Local tests

```sh
node --test scripts/deployment-plan.test.mjs scripts/replacement-plan.test.mjs
```

Tests use independent RLP/CREATE2 encodings for address derivation, deterministic salt mining, constructor decoding, nonce changes, plan tampering, runtime masking, receipt identity, stale artifacts and explicit incomplete-gas behavior. They require no network or wallet.

## One-transaction replacement using the existing registry

The approved media-flexible/cumulative-volume release reuses the existing registry and deploys only a new coordinator, which atomically creates its new engine/factory/router. Old deployments and their source-evidence files are not overwritten or upgraded.

```sh
node scripts/prepare-deployment.mjs \
  --reuse-registry 0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F \
  --rpc-url https://rpc.mainnet.chain.robinhood.com --estimate-gas
```

Replacement plans have schema `carve-unsigned-replacement-v1`, `reusedRegistry: {address,runtimeCodeHash}`, and exactly one entry in `transactions`. The coordinator uses the supplied/observed nonce directly; it does not add one for a registry deployment. Its factory/router still use coordinator nonces 2/3, and the engine's salt is freshly mined for the replacement address and current initcode.

`verifyReusedRegistry(client,address,artifact,blockNumber)` requires the existing registry's **entire** runtime to equal the reviewed no-immutable registry runtime and checks its three format constants. RPC-backed preparation runs this before planning and rechecks before returning. Replacement gas estimation only overrides sender balance/nonce; it never replaces the existing registry code or storage.

After the separately approved coordinator transaction, verify with only that hash:

```sh
node scripts/verify-deployment.mjs \
  --plan deployment-plans/unsigned-media-flexible-2026-09-15.json \
  --coordinator-tx 0xACTUAL_COORDINATOR_TRANSACTION_HASH \
  --rpc-url https://rpc.mainnet.chain.robinhood.com
```

Do not supply `--registry-tx` for a replacement. Programmatic callers pass `[coordinatorHash]` to `verifyDeployment`; initial deployments still require `[registryHash,coordinatorHash]`. The strong verifier validates the reused registry independently, then performs the same exact signed transaction, canonical receipt, full runtime and immutable/economic checks for the new deployment. Consumers must use `plan.transactions.length`, not hardcode two approvals or positional registry/coordinator assumptions.

The saved `unsigned-media-flexible-2026-09-15.json` is nonce 2, one zero-value coordinator creation, plan ID `0x532fad5f55d3ed7ee4f0842cda7d3f51167ca0f55388991698b253c254b655ff`. Its review and test evidence are in `deployment-plans/media-flexible-review-2026-09-15.json`. Never reuse this plan after an intervening wallet transaction or artifact change.

### Lifetime-volume getter semantics

`market.curveVolumeETH()` counts executed native reserve legs: net reserve input on buys and pre-external-fee ETH output on sells. `engine.poolVolumeETH(token)` counts the absolute pre-hook native core swap delta for that token; **the mapping key is token, not market**. Add those two values for lifetime native trading volume. Initial curve buys count; migration/liquidity movement, transfers, donations, withdrawals, failed transactions and deliberate Quoter reverts do not. These counters avoid unbounded historical-log scanning; they do not measure USD value or unique/non-wash trading activity.
