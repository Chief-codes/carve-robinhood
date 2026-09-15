#!/usr/bin/env node
// Creates unsigned data only. No signing, wallet client, private key or broadcast method.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(new URL('../../../outputs/Carve/package.json', import.meta.url));
export const viem = require('viem');
const { createPublicClient, http, getAddress, getCreateAddress, getCreate2Address,
  encodeDeployData, keccak256, toHex } = viem;

export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CHAIN_ID = 4663;
export const APPROVED_WALLET = '0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048';
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const POOL_MANAGER_CODE_HASH = '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626';
export const HOOK_MASK = 0x3fffn;
export const HOOK_FLAGS = 0x2044n;
export const ARTIFACT_NAMES = ['CarveContentRegistry', 'CarveDeployment', 'CarveV4Engine', 'CarveFactoryV2', 'CarveV4Router'];
export const APPROVED_ECONOMICS = Object.freeze({
  supply: '1000000000000000000000000000', creationFee: '500000000000000',
  virtualETH: '1680000000000000000', capETH: '4200000000000000000',
  platformFeeBps: '100', creatorFeeLimitBps: '1000',
});

function check(condition, message) { if (!condition) throw new Error(message); }
function isCode(value) { return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value); }
export function json(value) { return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2); }
export function shortError(error) {
  return String(error.shortMessage || error.message || error.name).split('\n')[0].replace(/https?:\/\/\S+/g, '[RPC URL]');
}

/** Reject stale sources, unsupported settings and unresolved bytecode before planning any address. */
export async function readArtifact(name, projectRoot = PROJECT_ROOT) {
  check(ARTIFACT_NAMES.includes(name), 'Unexpected artifact name');
  const filename = resolve(projectRoot, 'out', `${name}.sol`, `${name}.json`);
  let raw;
  try { raw = JSON.parse(await readFile(filename, 'utf8')); }
  catch { throw new Error(`Missing/unreadable ${name} build artifact; complete forge build first.`); }
  const metadata = raw.metadata || JSON.parse(raw.rawMetadata);
  check(metadata.compiler?.version?.startsWith('0.8.37+'), `${name}: expected pinned Solidity 0.8.37`);
  check(metadata.settings?.viaIR === true && metadata.settings?.evmVersion === 'cancun'
    && metadata.settings?.optimizer?.enabled === true && metadata.settings?.optimizer?.runs === 200,
  `${name}: unexpected compiler settings`);
  check(isCode(raw.bytecode?.object) && isCode(raw.deployedBytecode?.object), `${name}: missing/unlinked bytecode`);
  const sourceHashes = {};
  for (const [source, descriptor] of Object.entries(metadata.sources || {})) {
    const sourcePath = resolve(projectRoot, source);
    const local = relative(projectRoot, sourcePath);
    check(local !== '..' && !local.startsWith('../') && !isAbsolute(local), `${name}: source outside project`);
    const actual = keccak256(await readFile(sourcePath));
    check(actual === descriptor.keccak256, `${name}: stale artifact for ${source}; rebuild before planning.`);
    sourceHashes[source] = actual;
  }
  check(Object.keys(sourceHashes).length > 0, `${name}: source provenance missing`);
  return {
    name, abi: raw.abi, creationCode: raw.bytecode.object, runtimeCode: raw.deployedBytecode.object,
    immutableReferences: raw.deployedBytecode.immutableReferences || {}, sourceHashes,
    compilerVersion: metadata.compiler.version,
  };
}

export async function loadArtifacts(projectRoot = PROJECT_ROOT) {
  const values = await Promise.all(ARTIFACT_NAMES.map(name => readArtifact(name, projectRoot)));
  const artifacts = Object.fromEntries(values.map(value => [value.name, value]));
  const coordinator = artifacts.CarveDeployment.creationCode.toLowerCase();
  for (const name of ['CarveV4Engine', 'CarveFactoryV2', 'CarveV4Router']) {
    check(coordinator.includes(artifacts[name].creationCode.slice(2).toLowerCase()),
      `${name}: creation code differs from code embedded in coordinator; rebuild all artifacts together.`);
  }
  return artifacts;
}

/** CREATE2 consumes coordinator nonce 1; the following CREATEs therefore use 2 and 3. */
export function predictAddresses(deployer, pendingNonce, reuseRegistry) {
  deployer = getAddress(deployer);
  const nonce = BigInt(pendingNonce);
  check(nonce >= 0n && nonce < BigInt(Number.MAX_SAFE_INTEGER), 'Nonce must be nonnegative and safely representable by RPC tooling');
  const registry = reuseRegistry === undefined ? getCreateAddress({ from: deployer, nonce }) : getAddress(reuseRegistry);
  check(BigInt(registry) !== 0n, 'Reused registry must be nonzero');
  const coordinator = getCreateAddress({ from: deployer, nonce: nonce + (reuseRegistry === undefined ? 1n : 0n) });
  return {
    deployer, registry, coordinator,
    factory: getCreateAddress({ from: coordinator, nonce: 2n }),
    router: getCreateAddress({ from: coordinator, nonce: 3n }),
  };
}

export function mineHookSalt(coordinator, engineInitCodeHash, { startSalt = 0n, maxAttempts = 1_000_000 } = {}) {
  check(Number.isSafeInteger(maxAttempts) && maxAttempts > 0, 'maxAttempts must be a positive safe integer');
  let value = BigInt(startSalt);
  check(value >= 0n, 'startSalt must be nonnegative');
  for (let attempt = 1; attempt <= maxAttempts; ++attempt, ++value) {
    check(value < (1n << 256n), 'Salt exceeds bytes32');
    const salt = toHex(value, { size: 32 });
    const engine = getCreate2Address({ from: coordinator, salt, bytecodeHash: engineInitCodeHash });
    if ((BigInt(engine) & HOOK_MASK) === HOOK_FLAGS) return { salt, engine, attempts: attempt };
  }
  throw new Error('No valid hook salt found within the specified attempt budget');
}

export function makeUnsignedPlan(artifacts, {
  nonce, deployer = APPROVED_WALLET, platformRecipient = APPROVED_WALLET,
  salt, startSalt = 0n, maxAttempts = 1_000_000, reuseRegistry,
}) {
  const addresses = predictAddresses(deployer, nonce, reuseRegistry);
  platformRecipient = getAddress(platformRecipient);
  check(BigInt(platformRecipient) !== 0n, 'Platform recipient must be nonzero');
  const engineInitCode = encodeDeployData({ abi: artifacts.CarveV4Engine.abi,
    bytecode: artifacts.CarveV4Engine.creationCode, args: [POOL_MANAGER, addresses.factory] });
  const engineInitCodeHash = keccak256(engineInitCode);
  const mining = salt === undefined
    ? mineHookSalt(addresses.coordinator, engineInitCodeHash, { startSalt, maxAttempts })
    : { salt, engine: getCreate2Address({ from: addresses.coordinator, salt, bytecodeHash: engineInitCodeHash }), attempts: null };
  check(/^0x[0-9a-fA-F]{64}$/.test(mining.salt), 'Hook salt must be bytes32');
  check((BigInt(mining.engine) & HOOK_MASK) === HOOK_FLAGS, 'Salt does not produce the exact required hook permission bits');
  Object.assign(addresses, { engine: mining.engine, poolManager: POOL_MANAGER, platformRecipient });
  const registryData = encodeDeployData({ abi: artifacts.CarveContentRegistry.abi,
    bytecode: artifacts.CarveContentRegistry.creationCode });
  const coordinatorData = encodeDeployData({ abi: artifacts.CarveDeployment.abi,
    bytecode: artifacts.CarveDeployment.creationCode, args: [addresses.registry, platformRecipient, mining.salt] });
  check((coordinatorData.length - 2) / 2 <= 49_152, 'Coordinator initcode including arguments exceeds EIP-3860');
  const transactions = [
    ...(reuseRegistry === undefined ? [{ name: 'Deploy content registry', expectedContractAddress: addresses.registry, request: {
      from: addresses.deployer, to: null, chainId: toHex(CHAIN_ID), nonce: toHex(BigInt(nonce)), value: '0x0', data: registryData,
    } }] : []),
    { name: 'Deploy immutable coordinator, engine, factory and router', expectedContractAddress: addresses.coordinator, request: {
      from: addresses.deployer, to: null, chainId: toHex(CHAIN_ID),
      nonce: toHex(BigInt(nonce) + (reuseRegistry === undefined ? 1n : 0n)), value: '0x0', data: coordinatorData,
    } },
  ];
  const artifactHashes = Object.fromEntries(ARTIFACT_NAMES.map(name => [name, {
    creationCodeHash: keccak256(artifacts[name].creationCode),
    runtimeTemplateHash: keccak256(artifacts[name].runtimeCode),
    compilerVersion: artifacts[name].compilerVersion,
  }]));
  const core = {
    schema: reuseRegistry === undefined ? 'carve-unsigned-deployment-v1' : 'carve-unsigned-replacement-v1',
    chainId: CHAIN_ID, nonce: BigInt(nonce).toString(),
    addresses, canonicalPoolManagerCodeHash: POOL_MANAGER_CODE_HASH,
    hook: { mask: toHex(HOOK_MASK), flags: toHex(HOOK_FLAGS), salt: mining.salt, engineInitCodeHash },
    economics: APPROVED_ECONOMICS, artifactHashes,
    transactionDataHashes: transactions.map(transaction => keccak256(transaction.request.data)), transactions,
    ...(reuseRegistry === undefined ? {} : { reusedRegistry: {
      address: addresses.registry, runtimeCodeHash: keccak256(artifacts.CarveContentRegistry.runtimeCode),
    } }),
  };
  return {
    ...core, planId: keccak256(toHex(JSON.stringify(core))),
    miningAttempts: mining.attempts, unsigned: true,
    totalTransactionValueWei: '0',
    funding: { status: 'not-estimated', requiredBalanceWei: null,
      note: 'No launch fee or curve seed is required by deployment constructors. Transaction gas must be funded; no balance sufficiency is asserted.' },
    constraints: [
      reuseRegistry === undefined ? 'Confirm the registry transaction succeeded before submitting the coordinator transaction.'
        : 'Reuse only the exact existing registry runtime verified at preflight; no registry deployment or code override is included.',
      'Any changed nonce, deployer, bytecode or constructor input requires a newly mined plan.',
      'These unsigned requests intentionally omit gas and fee fields until simulation/review.',
    ],
  };
}

/** Reused registry has no immutable slots: every deployed runtime byte must match the reviewed build. */
export async function verifyReusedRegistry(client, address, artifact, blockNumber) {
  address = getAddress(address);
  check(BigInt(address) !== 0n, 'Reused registry must be nonzero');
  check(Object.values(artifact.immutableReferences || {}).every(references => references.length === 0),
    'Reused registry verification requires a runtime without mutable constructor substitutions');
  const code = await client.getBytecode({ address, blockNumber });
  check(code && code.toLowerCase() === artifact.runtimeCode.toLowerCase(), 'Reused registry full runtime mismatch');
  const checkedBindings = [];
  for (const [functionName, expected] of [['VERSION', 1n], ['MAX_CHUNK_BYTES', 20_480n], ['MAX_CHUNKS', 128n]]) {
    const actual = await client.readContract({ address, abi: artifact.abi, functionName, blockNumber });
    check(BigInt(actual) === expected, `Reused registry ${functionName} mismatch`);
    checkedBindings.push(functionName);
  }
  return { address, runtimeCodeHash: keccak256(code), checkedBindings, observedBlockNumber: blockNumber?.toString() ?? null };
}

export async function readPreflight(client, deployer = APPROVED_WALLET) {
  const [chainId, nonce, block] = await Promise.all([
    client.getChainId(), client.getTransactionCount({ address: deployer, blockTag: 'pending' }),
    client.getBlock({ blockTag: 'latest' }),
  ]);
  check(chainId === CHAIN_ID, `Wrong chain: expected ${CHAIN_ID}, received ${chainId}`);
  const code = await client.getBytecode({ address: POOL_MANAGER, blockNumber: block.number });
  check(code && keccak256(code) === POOL_MANAGER_CODE_HASH, 'Canonical PoolManager runtime code hash mismatch');
  return { chainId, pendingNonce: nonce, observedBlockNumber: block.number.toString(), observedBlockHash: block.hash,
    poolManagerCodeHash: keccak256(code), nonceSource: 'eth_getTransactionCount(pending)' };
}

/** Both estimates are real RPC simulations. Overrides model a funded sender and the preceding registry deployment. */
export async function estimateUnsignedPlan(client, plan, artifacts) {
  const estimates = [];
  for (let index = 0; index < plan.transactions.length; ++index) {
    const transaction = plan.transactions[index];
    const overrides = [{ address: plan.addresses.deployer, balance: (1n << 256n) - 1n,
      nonce: Number(BigInt(transaction.request.nonce)) }];
    if (index === 1 && plan.schema === 'carve-unsigned-deployment-v1')
      overrides.push({ address: plan.addresses.registry, code: artifacts.CarveContentRegistry.runtimeCode, nonce: 1 });
    try {
      const gas = await client.estimateGas({ account: transaction.request.from,
        data: transaction.request.data, value: 0n, nonce: Number(BigInt(transaction.request.nonce)),
        blockTag: 'pending', stateOverride: overrides });
      estimates.push({ index, status: 'simulated', gas: gas.toString() });
    } catch (error) { estimates.push({ index, status: 'unavailable', error: shortError(error) }); }
  }
  let gasPrice = null;
  try { gasPrice = await client.getGasPrice(); } catch { /* A missing fee quote never becomes zero. */ }
  const complete = estimates.every(estimate => estimate.status === 'simulated') && gasPrice !== null;
  const estimatedGas = complete ? estimates.reduce((total, estimate) => total + BigInt(estimate.gas), 0n) : null;
  return {
    status: complete ? 'simulated-estimate' : 'incomplete-estimate', estimates,
    gasPriceWei: gasPrice?.toString() ?? null, estimatedGas: estimatedGas?.toString() ?? null,
    estimatedExecutionFeeAtQuotedGasPriceWei: complete ? (estimatedGas * gasPrice).toString() : null,
    requiredBalanceWei: null,
    simulationAssumptions: ['Sender balance is overridden for simulation only; this is not evidence of available funds.',
      plan.schema === 'carve-unsigned-replacement-v1'
        ? 'Only the sender nonce/balance are overridden; the existing registry code and storage are used without replacement.'
        : 'Each sender nonce is overridden to its planned value; the coordinator simulation installs the planned registry runtime in temporary RPC state.'],
    note: 'Gas and the quoted gas price are estimates, not a guaranteed final funding requirement. No transactions were submitted.',
  };
}

export function publicClient(rpcUrl) {
  check(rpcUrl, 'Pass --rpc-url or set CARVE_RPC_URL for read-only RPC access');
  return createPublicClient({ transport: http(rpcUrl, { timeout: 30_000, retryCount: 0 }) });
}

async function main() {
  const { values } = parseArgs({ options: {
    'rpc-url': { type: 'string' }, 'offline-nonce': { type: 'string' }, out: { type: 'string' },
    'estimate-gas': { type: 'boolean', default: false }, 'start-salt': { type: 'string', default: '0' },
    'max-attempts': { type: 'string', default: '1000000' }, 'reuse-registry': { type: 'string' },
  } });
  const artifacts = await loadArtifacts();
  let client;
  let preflight;
  if (values['offline-nonce'] !== undefined) {
    check(!values['estimate-gas'], 'Offline nonce mode cannot estimate gas');
    preflight = { pendingNonce: values['offline-nonce'], nonceSource: 'provided-offline; refresh against RPC before signing', chainVerified: false };
  } else {
    client = publicClient(values['rpc-url'] || process.env.CARVE_RPC_URL);
    preflight = await readPreflight(client);
    if (values['reuse-registry']) preflight.reusedRegistry = await verifyReusedRegistry(client, values['reuse-registry'],
      artifacts.CarveContentRegistry, BigInt(preflight.observedBlockNumber));
  }
  const plan = makeUnsignedPlan(artifacts, { nonce: preflight.pendingNonce,
    startSalt: BigInt(values['start-salt']), maxAttempts: Number(values['max-attempts']), reuseRegistry: values['reuse-registry'] });
  plan.preflight = preflight;
  if (client && values['estimate-gas']) plan.funding = await estimateUnsignedPlan(client, plan, artifacts);
  if (client) {
    const currentNonce = await client.getTransactionCount({ address: APPROVED_WALLET, blockTag: 'pending' });
    check(BigInt(currentNonce) === BigInt(plan.nonce), 'Pending nonce changed while preparing; regenerate the plan');
    if (plan.reusedRegistry) await verifyReusedRegistry(client, plan.reusedRegistry.address, artifacts.CarveContentRegistry);
  }
  const finalArtifacts = await loadArtifacts();
  check(makeUnsignedPlan(finalArtifacts, { nonce: plan.nonce, salt: plan.hook.salt, reuseRegistry: values['reuse-registry'] }).planId === plan.planId,
    'Build artifacts changed during preparation; regenerate the plan');
  if (values.out) {
    const target = resolve(values.out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${json(plan)}\n`, { flag: 'wx' });
    console.log(json({ output: target, planId: plan.planId, addresses: plan.addresses, nonce: plan.nonce, funding: plan.funding }));
  } else console.log(json(plan));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(shortError(error)); process.exitCode = 1; });
}
