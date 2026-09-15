import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { viem, APPROVED_WALLET, POOL_MANAGER, HOOK_MASK, HOOK_FLAGS, ARTIFACT_NAMES,
  predictAddresses, mineHookSalt, makeUnsignedPlan, readArtifact, estimateUnsignedPlan } from './prepare-deployment.mjs';
import { assertRuntimeMatches, assertTransactionMatches, assertPlanMatchesArtifacts } from './verify-deployment.mjs';
const { parseAbi, getAddress, keccak256, encodeDeployData, getCreate2Address, toHex, decodeAbiParameters } = viem;

function fakeArtifacts() {
  const constructors = {
    CarveContentRegistry: [], CarveDeployment: ['constructor(address registry,address platformRecipient,bytes32 salt)'],
    CarveV4Engine: ['constructor(address poolManager,address factory)'], CarveFactoryV2: [], CarveV4Router: [],
  };
  return Object.fromEntries(ARTIFACT_NAMES.map((name, index) => [name, {
    name, abi: parseAbi(constructors[name]), creationCode: `0x60${index.toString(16).padStart(2, '0')}6000`,
    runtimeCode: '0x600000', immutableReferences: {}, compilerVersion: '0.8.37+test',
  }]));
}
const artifacts = fakeArtifacts();
const example = makeUnsignedPlan(artifacts, { nonce: 7n });

test('CREATE addresses agree with independently encoded RLP nonce cases', () => {
  for (const [nonce, prefix, suffix] of [[0n, 'd694', '80'], [1n, 'd694', '01'], [127n, 'd694', '7f'], [128n, 'd794', '8180']]) {
    const hash = keccak256(`0x${prefix}${APPROVED_WALLET.slice(2)}${suffix}`);
    assert.equal(predictAddresses(APPROVED_WALLET, nonce).registry, getAddress(`0x${hash.slice(-40)}`));
  }
});

test('coordinator engine CREATE2 consumes nonce 1; factory/router use 2/3', () => {
  const a = predictAddresses(APPROVED_WALLET, 7n);
  for (const [field, nonce] of [['factory', '02'], ['router', '03']]) {
    const hash = keccak256(`0xd694${a.coordinator.slice(2)}${nonce}`);
    assert.equal(a[field], getAddress(`0x${hash.slice(-40)}`));
  }
  assert.equal(a.coordinator, predictAddresses(APPROVED_WALLET, 8n).registry);
});

test('mined salt is deterministic and matches direct CREATE2 byte concatenation', () => {
  const first = mineHookSalt(example.addresses.coordinator, example.hook.engineInitCodeHash);
  const second = mineHookSalt(example.addresses.coordinator, example.hook.engineInitCodeHash);
  assert.deepEqual(first, second);
  const hash = keccak256(`0xff${example.addresses.coordinator.slice(2)}${first.salt.slice(2)}${example.hook.engineInitCodeHash.slice(2)}`);
  assert.equal(first.engine, getAddress(`0x${hash.slice(-40)}`));
  assert.equal(BigInt(first.engine) & HOOK_MASK, HOOK_FLAGS);
});

test('two unsigned zero-value transactions bind all constructor inputs', () => {
  assert.equal(example.transactions.length, 2);
  assert.equal(example.transactions[0].request.nonce, '0x7');
  assert.equal(example.transactions[1].request.nonce, '0x8');
  for (const transaction of example.transactions) {
    assert.equal(transaction.request.to, null);
    assert.equal(transaction.request.from, APPROVED_WALLET);
    assert.equal(transaction.request.value, '0x0');
    assert.equal(transaction.request.gas, undefined);
  }
  const encoded = example.transactions[1].request.data.slice(artifacts.CarveDeployment.creationCode.length);
  const [registry, platform, salt] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }], `0x${encoded}`);
  assert.equal(registry, example.addresses.registry);
  assert.equal(platform, APPROVED_WALLET);
  assert.equal(salt, example.hook.salt);
  const engineCode = encodeDeployData({ abi: artifacts.CarveV4Engine.abi, bytecode: artifacts.CarveV4Engine.creationCode,
    args: [POOL_MANAGER, example.addresses.factory] });
  assert.equal(keccak256(engineCode), example.hook.engineInitCodeHash);
  assert.equal(example.funding.requiredBalanceWei, null);
});

test('saved salt reproduces exactly the same plan id and requests', () => {
  const rebuilt = makeUnsignedPlan(artifacts, { nonce: 7n, salt: example.hook.salt });
  assert.equal(rebuilt.planId, example.planId);
  assert.deepEqual(rebuilt.transactions, example.transactions);
  assertPlanMatchesArtifacts(example, artifacts);
});

test('nonce changes invalidate predicted addresses and saved plan', () => {
  assert.notEqual(predictAddresses(APPROVED_WALLET, 8n).coordinator, example.addresses.coordinator);
  const changed = structuredClone(example);
  changed.nonce = '8';
  assert.throws(() => assertPlanMatchesArtifacts(changed, artifacts));
  assert.throws(() => predictAddresses(APPROVED_WALLET, -1n));
  assert.throws(() => predictAddresses(APPROVED_WALLET, BigInt(Number.MAX_SAFE_INTEGER)));
});

test('wrong hook mask and exhausted salt search fail closed', () => {
  let bad = 0n;
  while ((BigInt(getCreate2Address({ from: example.addresses.coordinator, salt: toHex(bad, { size: 32 }),
    bytecodeHash: example.hook.engineInitCodeHash })) & HOOK_MASK) === HOOK_FLAGS) ++bad;
  assert.throws(() => makeUnsignedPlan(artifacts, { nonce: 7n, salt: toHex(bad, { size: 32 }) }), /permission bits/);
  assert.throws(() => mineHookSalt(example.addresses.coordinator, example.hook.engineInitCodeHash,
    { startSalt: bad, maxAttempts: 1 }), /attempt budget/);
});

test('changed request data and addresses are rejected even with copied plan id', () => {
  const dataChanged = structuredClone(example); dataChanged.transactions[0].request.data = '0x00';
  assert.throws(() => assertPlanMatchesArtifacts(dataChanged, artifacts), /requests were changed/);
  const addressChanged = structuredClone(example); addressChanged.addresses.router = APPROVED_WALLET;
  assert.throws(() => assertPlanMatchesArtifacts(addressChanged, artifacts), /addresses were changed/);
  const economicsChanged = structuredClone(example); economicsChanged.economics.platformFeeBps = '0';
  assert.throws(() => assertPlanMatchesArtifacts(economicsChanged, artifacts), /economics differs/);
  const flagsChanged = structuredClone(example); flagsChanged.hook.flags = '0x2000';
  assert.throws(() => assertPlanMatchesArtifacts(flagsChanged, artifacts), /hook differs/);
});

test('runtime matcher ignores only declared immutable bytes', () => {
  const artifact = { name: 'Fixture', runtimeCode: '0x60000000', immutableReferences: { '1': [{ start: 1, length: 2 }] } };
  assert.equal(assertRuntimeMatches('0x60abcd00', artifact), keccak256('0x60abcd00'));
  assert.throws(() => assertRuntimeMatches('0x61abcd00', artifact), /outside immutable/);
  assert.throws(() => assertRuntimeMatches('0x60abcd', artifact), /length mismatch/);
  assert.throws(() => assertRuntimeMatches('0x', artifact), /no deployed code/);
});

test('receipt verification binds sender, nonce, successful creation and exact initcode', () => {
  const planned = example.transactions[0];
  const transaction = { from: APPROVED_WALLET, to: null, nonce: 7, value: 0n, input: planned.request.data, chainId: 4663 };
  const receipt = { status: 'success', contractAddress: planned.expectedContractAddress };
  assertTransactionMatches(transaction, receipt, planned);
  assert.throws(() => assertTransactionMatches({ ...transaction, nonce: 8 }, receipt, planned), /nonce/);
  assert.throws(() => assertTransactionMatches(transaction, { ...receipt, status: 'reverted' }, planned), /failed/);
  assert.throws(() => assertTransactionMatches({ ...transaction, input: '0x00' }, receipt, planned), /initcode/);
  assert.throws(() => assertTransactionMatches({ ...transaction, to: APPROVED_WALLET }, receipt, planned), /not contract creation/);
  assert.throws(() => assertTransactionMatches({ ...transaction, chainId: 1 }, receipt, planned), /chain ID/);
});

test('artifact loader rejects stale sources and unresolved bytecode', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'carve-planner-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await mkdir(join(temporary, 'out/CarveContentRegistry.sol'), { recursive: true });
  await mkdir(join(temporary, 'src'));
  const source = '// fixture source\n';
  await writeFile(join(temporary, 'src/Fixture.sol'), source);
  const raw = { abi: [], bytecode: { object: '0x600000' }, deployedBytecode: { object: '0x600000', immutableReferences: {} },
    metadata: { compiler: { version: '0.8.37+test' }, settings: { viaIR: true, evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 } },
      sources: { 'src/Fixture.sol': { keccak256: keccak256(toHex(source)) } } } };
  const target = join(temporary, 'out/CarveContentRegistry.sol/CarveContentRegistry.json');
  await writeFile(target, JSON.stringify(raw));
  assert.equal((await readArtifact('CarveContentRegistry', temporary)).creationCode, '0x600000');
  await writeFile(join(temporary, 'src/Fixture.sol'), '// changed\n');
  await assert.rejects(readArtifact('CarveContentRegistry', temporary), /stale artifact/);
  raw.bytecode.object = '0x__$unresolved$__'; await writeFile(target, JSON.stringify(raw));
  await assert.rejects(readArtifact('CarveContentRegistry', temporary), /unlinked bytecode/);
});

test('gas numbers are emitted only for completed simulations and remain estimates', async () => {
  const calls = [];
  const client = { estimateGas: async request => { calls.push(request); return calls.length === 1 ? 100n : 200n; }, getGasPrice: async () => 3n };
  const result = await estimateUnsignedPlan(client, example, artifacts);
  assert.equal(result.status, 'simulated-estimate');
  assert.equal(result.estimatedExecutionFeeAtQuotedGasPriceWei, '900');
  assert.equal(result.requiredBalanceWei, null);
  assert.equal(calls[1].stateOverride[0].nonce, 8);
  assert.equal(calls[1].stateOverride[1].address, example.addresses.registry);
  const unavailable = await estimateUnsignedPlan({ estimateGas: async () => { throw new Error('RPC unsupported'); }, getGasPrice: async () => 3n }, example, artifacts);
  assert.equal(unavailable.status, 'incomplete-estimate');
  assert.equal(unavailable.estimatedExecutionFeeAtQuotedGasPriceWei, null);
});
