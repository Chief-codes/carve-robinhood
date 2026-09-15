#!/usr/bin/env node
// Read-only: validates signed transaction identities and resulting deployed contracts; never submits.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { viem, loadArtifacts, makeUnsignedPlan, publicClient, json, shortError,
  CHAIN_ID, APPROVED_WALLET, POOL_MANAGER, POOL_MANAGER_CODE_HASH, APPROVED_ECONOMICS, HOOK_MASK, HOOK_FLAGS,
  verifyReusedRegistry } from './prepare-deployment.mjs';
const { getAddress, keccak256 } = viem;
function check(condition, message) { if (!condition) throw new Error(message); }
function sameAddress(a, b) { return a && b && getAddress(a) === getAddress(b); }

/** Compare the full compiled runtime, masking only compiler-declared immutable bytes. Getters are checked separately. */
export function assertRuntimeMatches(actual, artifact) {
  check(actual && /^0x(?:[0-9a-fA-F]{2})+$/.test(actual), `${artifact.name}: no deployed code`);
  const expected = Buffer.from(artifact.runtimeCode.slice(2), 'hex');
  const observed = Buffer.from(actual.slice(2), 'hex');
  check(expected.length === observed.length, `${artifact.name}: runtime length mismatch`);
  for (const references of Object.values(artifact.immutableReferences)) for (const { start, length } of references) {
    check(Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length > 0
      && start + length <= expected.length, `${artifact.name}: invalid immutable reference`);
    expected.fill(0, start, start + length);
    observed.fill(0, start, start + length);
  }
  check(observed.equals(expected), `${artifact.name}: runtime differs outside immutable slots`);
  return keccak256(actual);
}

export function assertTransactionMatches(transaction, receipt, planned) {
  check(receipt.status === 'success', `${planned.name}: transaction failed`);
  check(transaction.chainId != null && BigInt(transaction.chainId) === BigInt(CHAIN_ID), `${planned.name}: signed chain ID mismatch or unavailable`);
  check(sameAddress(transaction.from, planned.request.from), `${planned.name}: unexpected sender`);
  check(transaction.to == null, `${planned.name}: transaction is not contract creation`);
  check(BigInt(transaction.nonce) === BigInt(planned.request.nonce), `${planned.name}: nonce mismatch`);
  check(BigInt(transaction.value) === 0n, `${planned.name}: unexpected value`);
  check((transaction.input || transaction.data)?.toLowerCase() === planned.request.data.toLowerCase(), `${planned.name}: initcode mismatch`);
  check(sameAddress(receipt.contractAddress, planned.expectedContractAddress), `${planned.name}: created address mismatch`);
}

export function assertPlanMatchesArtifacts(plan, artifacts) {
  const replacement = plan.schema === 'carve-unsigned-replacement-v1';
  check((plan.schema === 'carve-unsigned-deployment-v1' || replacement) && plan.unsigned === true && plan.chainId === CHAIN_ID, 'Unsupported deployment plan');
  check(replacement ? !!plan.reusedRegistry?.address : plan.reusedRegistry === undefined, 'Reused registry descriptor does not match plan mode');
  check(sameAddress(plan.addresses?.deployer, APPROVED_WALLET)
    && sameAddress(plan.addresses?.platformRecipient, APPROVED_WALLET), 'Plan differs from approved deployer/platform wallet');
  const expected = makeUnsignedPlan(artifacts, { nonce: plan.nonce, salt: plan.hook?.salt,
    reuseRegistry: replacement ? plan.reusedRegistry.address : undefined });
  check(plan.planId === expected.planId, 'Plan does not match the current reviewed artifacts/configuration');
  check(JSON.stringify(plan.transactions) === JSON.stringify(expected.transactions), 'Unsigned transaction requests were changed');
  check(JSON.stringify(plan.addresses) === JSON.stringify(expected.addresses), 'Predicted addresses were changed');
  for (const field of ['nonce', 'canonicalPoolManagerCodeHash', 'hook', 'economics', 'artifactHashes', 'transactionDataHashes',
    ...(replacement ? ['reusedRegistry'] : [])]) {
    check(JSON.stringify(plan[field]) === JSON.stringify(expected[field]), `Plan ${field} differs from its bound contents`);
  }
  return expected;
}

export async function verifyDeployment(client, plan, artifacts, transactionHashes) {
  const expected = assertPlanMatchesArtifacts(plan, artifacts);
  check(Array.isArray(transactionHashes) && transactionHashes.length === expected.transactions.length
    && transactionHashes.every(hash => /^0x[0-9a-fA-F]{64}$/.test(hash)), 'Provide exactly the confirmed transaction hashes required by this plan');
  check(await client.getChainId() === CHAIN_ID, `Wrong chain: expected ${CHAIN_ID}`);
  const receiptPairs = await Promise.all(transactionHashes.map(async (hash, index) => {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash }), client.getTransactionReceipt({ hash }),
    ]);
    check(transaction.hash?.toLowerCase() === hash.toLowerCase() && receipt.transactionHash?.toLowerCase() === hash.toLowerCase(),
      'RPC transaction/receipt hash mismatch');
    assertTransactionMatches(transaction, receipt, expected.transactions[index]);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    check(block.hash === receipt.blockHash, 'Deployment receipt is not in the current canonical chain');
    return { transaction, receipt };
  }));
  if (receiptPairs.length === 2)
    check(receiptPairs[0].receipt.blockNumber <= receiptPairs[1].receipt.blockNumber, 'Coordinator receipt precedes registry receipt');
  const block = await client.getBlock({ blockTag: 'latest' });
  const blockNumber = block.number;
  const reusedRegistry = expected.reusedRegistry ? await verifyReusedRegistry(client, expected.reusedRegistry.address,
    artifacts.CarveContentRegistry, blockNumber) : undefined;
  const poolCode = await client.getBytecode({ address: POOL_MANAGER, blockNumber });
  check(poolCode && keccak256(poolCode) === POOL_MANAGER_CODE_HASH, 'Canonical PoolManager runtime mismatch');
  check((BigInt(expected.addresses.engine) & HOOK_MASK) === HOOK_FLAGS, 'Engine hook flags mismatch');

  const contracts = {
    registry: 'CarveContentRegistry', coordinator: 'CarveDeployment', engine: 'CarveV4Engine',
    factory: 'CarveFactoryV2', router: 'CarveV4Router',
  };
  const runtimeHashes = Object.fromEntries(await Promise.all(Object.entries(contracts).map(async ([field, name]) => {
    const code = await client.getBytecode({ address: expected.addresses[field], blockNumber });
    return [field, assertRuntimeMatches(code, artifacts[name])];
  })));

  const a = expected.addresses;
  const bindings = [
    ['coordinator', 'registry', a.registry], ['coordinator', 'engine', a.engine],
    ['coordinator', 'factory', a.factory], ['coordinator', 'router', a.router],
    ['coordinator', 'POOL_MANAGER', POOL_MANAGER], ['coordinator', 'POOL_MANAGER_CODE_HASH', POOL_MANAGER_CODE_HASH],
    ['engine', 'factory', a.factory], ['engine', 'poolManager', POOL_MANAGER],
    ['engine', 'HOOK_FLAGS', HOOK_FLAGS], ['engine', 'CREATOR_FEE_LIMIT_BPS', 1000n],
    ['factory', 'registry', a.registry], ['factory', 'platformRecipient', a.platformRecipient],
    ['factory', 'migrationAdapter', a.engine], ['factory', 'locker', a.engine],
    ['router', 'engine', a.engine], ['router', 'poolManager', POOL_MANAGER],
    ['registry', 'VERSION', 1n], ['registry', 'MAX_CHUNK_BYTES', 20_480n], ['registry', 'MAX_CHUNKS', 128n],
    ...Object.entries(APPROVED_ECONOMICS).map(([getter, value]) => ['factory', getter, BigInt(value)]),
  ];
  const checkedBindings = await Promise.all(bindings.map(async ([field, functionName, wanted]) => {
    const actual = await client.readContract({ address: a[field], abi: artifacts[contracts[field]].abi, functionName, blockNumber });
    const matches = typeof wanted === 'bigint' ? BigInt(actual) === wanted
      : wanted.length === 42 ? sameAddress(actual, wanted) : actual.toLowerCase() === wanted.toLowerCase();
    check(matches, `${field}.${functionName}: immutable binding/economics mismatch`);
    return `${field}.${functionName}`;
  }));
  const receiptCosts = receiptPairs.map(({ receipt }, index) => ({
    index, name: expected.transactions[index].name, transactionHash: transactionHashes[index], contractAddress: receipt.contractAddress,
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice?.toString() ?? null,
    executionFeeWei: receipt.effectiveGasPrice == null ? null : (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
  }));
  return {
    verified: true, planId: expected.planId, chainId: CHAIN_ID,
    verifiedAt: { blockNumber: blockNumber.toString(), blockHash: block.hash },
    addresses: a, runtimeHashes, canonicalPoolManagerCodeHash: keccak256(poolCode),
    checkedBindings, receipts: receiptCosts,
    ...(reusedRegistry ? { reusedRegistry } : {}),
    note: 'Read-only deployment verification. Receipt execution fees are gasUsed × effectiveGasPrice; no claim about future gas prices or additional chain-specific charges.',
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    plan: { type: 'string' }, 'rpc-url': { type: 'string' }, 'registry-tx': { type: 'string' }, 'coordinator-tx': { type: 'string' },
  } });
  check(values.plan && values['coordinator-tx'],
    'Usage: verify-deployment.mjs --plan PLAN.json [--registry-tx HASH] --coordinator-tx HASH --rpc-url URL');
  const [plan, artifacts] = await Promise.all([
    readFile(resolve(values.plan), 'utf8').then(JSON.parse), loadArtifacts(),
  ]);
  const replacement = plan.schema === 'carve-unsigned-replacement-v1';
  check(replacement ? !values['registry-tx'] : !!values['registry-tx'],
    replacement ? 'Replacement plans reuse the registry; provide only --coordinator-tx.' : 'Initial plans require both deployment transaction hashes.');
  console.log(json(await verifyDeployment(publicClient(values['rpc-url'] || process.env.CARVE_RPC_URL),
    plan, artifacts, replacement ? [values['coordinator-tx']] : [values['registry-tx'], values['coordinator-tx']])));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(shortError(error)); process.exitCode = 1; });
}
