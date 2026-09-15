import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {viem,APPROVED_WALLET,POOL_MANAGER,POOL_MANAGER_CODE_HASH,APPROVED_ECONOMICS,ARTIFACT_NAMES,
  predictAddresses,makeUnsignedPlan,verifyReusedRegistry,estimateUnsignedPlan} from './prepare-deployment.mjs';
import {assertPlanMatchesArtifacts,verifyDeployment} from './verify-deployment.mjs';
const {parseAbi,getAddress,keccak256,decodeAbiParameters,toHex}=viem;
const registry='0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F';
const constructors={CarveContentRegistry:[],CarveDeployment:['constructor(address registry,address platformRecipient,bytes32 salt)'],
  CarveV4Engine:['constructor(address poolManager,address factory)'],CarveFactoryV2:[],CarveV4Router:[]};
const artifacts=Object.fromEntries(ARTIFACT_NAMES.map((name,index)=>[name,{name,abi:parseAbi(constructors[name]),
  creationCode:`0x60${index.toString(16).padStart(2,'0')}6000`,runtimeCode:'0x600000',immutableReferences:{},compilerVersion:'0.8.37+test'}]));
const plan=makeUnsignedPlan(artifacts,{nonce:2,reuseRegistry:registry});

test('replacement consumes exactly the requested coordinator nonce and reuses registry',()=>{
  const a=predictAddresses(APPROVED_WALLET,2,registry);
  const coordinator=getAddress('0x'+keccak256(`0xd694${APPROVED_WALLET.slice(2)}02`).slice(-40));
  assert.equal(a.coordinator,coordinator);assert.equal(a.registry,registry);
  for(const [field,nonce] of [['factory','02'],['router','03']])
    assert.equal(a[field],getAddress('0x'+keccak256(`0xd694${coordinator.slice(2)}${nonce}`).slice(-40)));
  assert.equal(plan.schema,'carve-unsigned-replacement-v1');assert.equal(plan.transactions.length,1);
  assert.equal(plan.transactions[0].request.nonce,'0x2');assert.equal(plan.transactions[0].request.value,'0x0');
  assert.equal(plan.transactions[0].expectedContractAddress,coordinator);
  assert.deepEqual(plan.reusedRegistry,{address:registry,runtimeCodeHash:keccak256(artifacts.CarveContentRegistry.runtimeCode)});
  assert.throws(()=>predictAddresses(APPROVED_WALLET,2,'0x'+'00'.repeat(20)),/nonzero/);
});

test('one-step calldata binds the reused registry, approved beneficiary and exact hook salt',()=>{
  const encoded=plan.transactions[0].request.data.slice(artifacts.CarveDeployment.creationCode.length);
  const values=decodeAbiParameters([{type:'address'},{type:'address'},{type:'bytes32'}],`0x${encoded}`);
  assert.deepEqual(values,[registry,APPROVED_WALLET,plan.hook.salt]);
  const rebuilt=makeUnsignedPlan(artifacts,{nonce:2,reuseRegistry:registry,salt:plan.hook.salt});
  assert.equal(rebuilt.planId,plan.planId);assert.deepEqual(rebuilt.transactions,plan.transactions);
  assertPlanMatchesArtifacts(plan,artifacts);
});

test('changed registry address/hash, nonce, schema or inserted transaction invalidates replacement plan',()=>{
  const changes=[p=>p.reusedRegistry.address=APPROVED_WALLET,p=>p.reusedRegistry.runtimeCodeHash=toHex(1n,{size:32}),
    p=>p.addresses.registry=APPROVED_WALLET,p=>p.nonce='3',p=>p.schema='carve-unsigned-deployment-v1',
    p=>p.transactions.push(p.transactions[0])];
  for(const change of changes){const changed=structuredClone(plan);change(changed);assert.throws(()=>assertPlanMatchesArtifacts(changed,artifacts));}
});

test('reused registry requires every runtime byte and every format constant',async()=>{
  const calls=[];
  const client={getBytecode:async request=>{calls.push(request);return '0x600000';},
    readContract:async request=>({VERSION:1n,MAX_CHUNK_BYTES:20480n,MAX_CHUNKS:128n})[request.functionName]};
  const result=await verifyReusedRegistry(client,registry,artifacts.CarveContentRegistry,123n);
  assert.equal(result.runtimeCodeHash,plan.reusedRegistry.runtimeCodeHash);assert.equal(result.observedBlockNumber,'123');
  assert.equal(calls[0].blockNumber,123n);assert.equal(result.checkedBindings.length,3);
  await assert.rejects(()=>verifyReusedRegistry({...client,getBytecode:async()=>undefined},registry,artifacts.CarveContentRegistry),/runtime mismatch/);
  await assert.rejects(()=>verifyReusedRegistry({...client,getBytecode:async()=> '0x600001'},registry,artifacts.CarveContentRegistry),/runtime mismatch/);
  await assert.rejects(()=>verifyReusedRegistry({...client,readContract:async()=>0n},registry,artifacts.CarveContentRegistry),/VERSION mismatch/);
  await assert.rejects(()=>verifyReusedRegistry(client,registry,{...artifacts.CarveContentRegistry,immutableReferences:{x:[{start:0,length:1}]}}),/substitutions/);
});

test('replacement gas simulation never installs or overwrites registry code/storage',async()=>{
  const calls=[];
  const funding=await estimateUnsignedPlan({estimateGas:async request=>{calls.push(request);return 7700000n;},getGasPrice:async()=>3n},plan,artifacts);
  assert.equal(calls.length,1);assert.equal(calls[0].nonce,2);assert.equal(calls[0].stateOverride.length,1);
  assert.equal(calls[0].stateOverride[0].address,APPROVED_WALLET);assert.equal(calls[0].stateOverride[0].nonce,2);
  assert.equal(calls[0].stateOverride[0].code,undefined);assert.equal(funding.status,'simulated-estimate');
  assert.equal(funding.estimatedGas,'7700000');assert.equal(funding.requiredBalanceWei,null);
});

async function verifierFixture(){
  const core=(await readFile(new URL('../test/fixtures/PoolManager-4663-runtime.hex',import.meta.url),'utf8')).trim();
  assert.equal(keccak256(core),POOL_MANAGER_CODE_HASH);
  const hash=toHex(123n,{size:32}),a=plan.addresses;
  const block=n=>({number:n,hash:toHex(n,{size:32})});
  const transaction={hash,chainId:4663,from:APPROVED_WALLET,to:null,nonce:2,value:0n,input:plan.transactions[0].request.data};
  const receipt={transactionHash:hash,status:'success',contractAddress:a.coordinator,blockNumber:900n,
    blockHash:block(900n).hash,gasUsed:7700000n,effectiveGasPrice:3n};
  const fieldFor=address=>Object.keys(a).find(field=>a[field].toLowerCase()===address.toLowerCase());
  const values={coordinator:{registry:a.registry,engine:a.engine,factory:a.factory,router:a.router,POOL_MANAGER,POOL_MANAGER_CODE_HASH},
    engine:{factory:a.factory,poolManager:POOL_MANAGER,HOOK_FLAGS:0x2044n,CREATOR_FEE_LIMIT_BPS:1000n},
    factory:{registry:a.registry,platformRecipient:APPROVED_WALLET,migrationAdapter:a.engine,locker:a.engine,
      ...Object.fromEntries(Object.entries(APPROVED_ECONOMICS).map(([k,v])=>[k,BigInt(v)]))},
    router:{engine:a.engine,poolManager:POOL_MANAGER},registry:{VERSION:1n,MAX_CHUNK_BYTES:20480n,MAX_CHUNKS:128n}};
  const client={getChainId:async()=>4663,getTransaction:async()=>transaction,getTransactionReceipt:async()=>receipt,
    getBlock:async request=>block(request.blockNumber??1000n),
    getBytecode:async({address})=>address.toLowerCase()===POOL_MANAGER.toLowerCase()?core:'0x600000',
    readContract:async({address,functionName})=>values[fieldFor(address)][functionName]};
  return {client,hash,receipt};
}

test('strong verifier accepts one coordinator receipt and independently checks reused registry',async()=>{
  const {client,hash}=await verifierFixture();
  const result=await verifyDeployment(client,plan,artifacts,[hash]);
  assert.equal(result.verified,true);assert.equal(result.receipts.length,1);
  assert.equal(result.receipts[0].contractAddress,plan.addresses.coordinator);
  assert.equal(result.reusedRegistry.address,registry);assert.equal(result.reusedRegistry.runtimeCodeHash,plan.reusedRegistry.runtimeCodeHash);
  assert.equal(result.checkedBindings.length,25);assert.equal(result.canonicalPoolManagerCodeHash,POOL_MANAGER_CODE_HASH);
  await assert.rejects(()=>verifyDeployment(client,plan,artifacts,[hash,hash]),/exactly/);
});

test('strong replacement verifier fails on altered reused runtime, format, receipt or canonical block',async()=>{
  const {client,hash,receipt}=await verifierFixture();
  await assert.rejects(()=>verifyDeployment({...client,getBytecode:async request=>request.address.toLowerCase()===registry.toLowerCase()?'0x600001':client.getBytecode(request)},plan,artifacts,[hash]),/registry full runtime/);
  await assert.rejects(()=>verifyDeployment({...client,readContract:async request=>request.functionName==='VERSION'?2n:client.readContract(request)},plan,artifacts,[hash]),/VERSION mismatch/);
  await assert.rejects(()=>verifyDeployment({...client,getTransactionReceipt:async()=>({...receipt,status:'reverted'})},plan,artifacts,[hash]),/transaction failed/);
  await assert.rejects(()=>verifyDeployment({...client,getBlock:async()=>({number:900n,hash:toHex(1n,{size:32})})},plan,artifacts,[hash]),/canonical chain/);
});
