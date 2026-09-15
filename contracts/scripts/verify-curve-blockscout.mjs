#!/usr/bin/env node
// Public source verification only. No wallet, credentials, signing or transaction RPC methods.
// Default mode prepares and locally reproduces one compiler input; --submit is explicit.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadArtifacts,viem,json,PROJECT_ROOT} from './prepare-curve-deployment.mjs';
import {assertPlanMatchesArtifacts} from './verify-curve-deployment.mjs';
const require=createRequire(import.meta.url);
const solc=require('solc');
const {encodeAbiParameters,keccak256,toHex}=viem;
const API='https://robinhoodchain.blockscout.com/api/';
const names={registry:'CarveContentRegistry',coordinator:'CarveCurveDeployment',factory:'CarveCurveFactory',router:'CarveCurveRouter',engine:'CarveCurveEngine'};
function check(condition,message){if(!condition)throw new Error(message);}

export async function prepareSourceVerification(field,options={}){
  check(Object.hasOwn(names,field),'Choose registry, coordinator, factory, router or engine.');
  const [plan,verified,artifacts]=await Promise.all([
    readFile(resolve(PROJECT_ROOT,options.planPath||'deployment-plans/unsigned-candidate-2026-09-15.json'),'utf8').then(JSON.parse),
    readFile(resolve(PROJECT_ROOT,options.verifiedPath||'deployment-plans/mainnet-verified-2026-09-15.json'),'utf8').then(JSON.parse),
    loadArtifacts(),
  ]);
  assertPlanMatchesArtifacts(plan,artifacts);
  check(verified.verified===true&&verified.planId===plan.planId,'A matching successful independent deployment report is required.');
  const name=names[field],artifact=artifacts[name];
  const raw=JSON.parse(await readFile(resolve(PROJECT_ROOT,'out',`${name}.sol`,`${name}.json`),'utf8'));
  const metadata=raw.metadata||JSON.parse(raw.rawMetadata);
  const {compilationTarget,...settings}=metadata.settings;
  const [[sourcePath,targetName]]=Object.entries(compilationTarget);
  check(targetName===name,'Unexpected compilation target.');
  check(metadata.compiler.version==='0.8.37+commit.f401782d'&&solc.version().startsWith(metadata.compiler.version),
    'The exact local Solidity 0.8.37 compiler is required.');
  const sources=Object.fromEntries(await Promise.all(Object.keys(metadata.sources).map(async source=>[
    source,{content:await readFile(resolve(PROJECT_ROOT,source),'utf8')},
  ])));
  const standardInput={language:'Solidity',sources,settings:{...settings,
    outputSelection:{'*':{'*':['abi','metadata','evm.bytecode','evm.deployedBytecode']}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(standardInput)));
  const errors=(output.errors||[]).filter(error=>error.severity==='error');
  check(errors.length===0,errors.map(error=>error.formattedMessage).join('\n'));
  const compiled=output.contracts?.[sourcePath]?.[name];
  check(compiled&&'0x'+compiled.evm.bytecode.object===artifact.creationCode,
    `${name}: prepared standard JSON does not reproduce the reviewed creation bytecode.`);
  check('0x'+compiled.evm.deployedBytecode.object===artifact.runtimeCode,
    `${name}: prepared standard JSON does not reproduce the reviewed runtime template.`);
  const a=plan.addresses;
  const values={registry:[],coordinator:[a.registry,a.platformRecipient,plan.hook.salt],
    factory:[a.registry,a.platformRecipient,a.engine],router:[a.engine],engine:[a.poolManager,a.factory]}[field];
  const constructor=artifact.abi.find(item=>item.type==='constructor');
  const constructorArguments=values.length?encodeAbiParameters(constructor.inputs,values):'0x';
  return {field,name,address:a[field],contractName:`${sourcePath}:${name}`,compilerVersion:'v'+metadata.compiler.version,
    constructorArguments,standardInput,standardInputHash:keccak256(toHex(JSON.stringify(standardInput))),
    creationCodeHash:keccak256(artifact.creationCode),deployedRuntimeHash:verified.runtimeHashes[field],
    planId:plan.planId,sourceCount:Object.keys(sources).length,locallyReproduced:true};
}

async function apiRequest(method,parameters){
  const response=await fetch(method==='GET'?API+'?'+new URLSearchParams(parameters):API,
    method==='GET'?{signal:AbortSignal.timeout(30000)}:{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(parameters),signal:AbortSignal.timeout(30000)});
  const body=await response.text();
  if(!response.ok)return {httpStatus:response.status,error:/Just a moment|cf_chl|Cloudflare/i.test(body)?
    'Explorer returned a Cloudflare challenge; no bypass was attempted.':body.slice(0,1000)};
  try{return {httpStatus:response.status,...JSON.parse(body)};}
  catch{return {httpStatus:response.status,error:'Explorer returned non-JSON content; no accepted verification is established.'};}
}

export async function submitSourceVerification(prepared){
  const submitted=await apiRequest('POST',{module:'contract',action:'verifysourcecode',
    codeformat:'solidity-standard-json-input',contractaddress:prepared.address,contractname:prepared.contractName,
    compilerversion:prepared.compilerVersion,sourceCode:JSON.stringify(prepared.standardInput),
    constructorArguments:prepared.constructorArguments.slice(2),licenseType:'mit'});
  if(submitted.status!=='1')return {status:'not-accepted',submitted};
  const guid=submitted.result;
  check(typeof guid==='string'&&guid.length>0,'Verification response did not contain a GUID.');
  const checks=[];
  for(let attempt=0;attempt<6;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    const response=await apiRequest('GET',{module:'contract',action:'checkverifystatus',guid});checks.push(response);
    if(response.result==='Pass - Verified')return {status:'verified',guid,submitted,checks};
    if(response.result!=='Pending in queue')return {status:'not-verified',guid,submitted,checks};
  }
  return {status:'pending',guid,submitted,checks};
}

async function main(){
  const {values}=parseArgs({options:{contract:{type:'string'},plan:{type:'string'},verified:{type:'string'},submit:{type:'boolean',default:false},'emit-standard-input':{type:'boolean',default:false}}});
  check(values.contract,'Usage: node scripts/verify-blockscout.mjs --contract registry [--plan PLAN.json --verified VERIFIED.json] [--submit | --emit-standard-input]');
  check(!!values.plan===!!values.verified,'Provide both --plan and --verified, or neither.');
  check(!(values.submit&&values['emit-standard-input']),'Choose submit or emit-standard-input, not both.');
  const prepared=await prepareSourceVerification(values.contract,{planPath:values.plan,verifiedPath:values.verified});
  if(values['emit-standard-input']){console.log(json(prepared.standardInput));return;}
  const {standardInput,...summary}=prepared;
  const verification=values.submit?await submitSourceVerification(prepared):{status:'prepared-not-submitted'};
  console.log(json({...summary,explorerAPI:API,checkedAt:new Date().toISOString(),
    verification}));
  if(values.submit&&verification.status!=='verified')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(String(error.message||error));process.exitCode=1;});
