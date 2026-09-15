#!/usr/bin/env node
// Public source verification for a token/market created inside a Carve launch transaction.
// It never accesses a wallet or sends an onchain transaction.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

const root=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
const {createPublicClient,http,keccak256,toHex}=require('../../../outputs/Carve/node_modules/viem');
const solc=require('solc');
const names=new Set(['CarveToken','CarveCurveMarket']);
const rpc='https://rpc.mainnet.chain.robinhood.com';
const api='https://sourcify.dev/server';
const fail=message=>{throw new Error(message);};

const {values}=parseArgs({options:{contract:{type:'string'},address:{type:'string'},'creation-tx':{type:'string'}}});
if(!names.has(values.contract)) fail('Choose CarveToken or CarveCurveMarket.');
if(!/^0x[\da-f]{40}$/i.test(values.address||'')) fail('Invalid contract address.');
if(!/^0x[\da-f]{64}$/i.test(values['creation-tx']||'')) fail('Invalid launch transaction hash.');
const raw=JSON.parse(await readFile(resolve(root,'out',`${values.contract}.sol`,`${values.contract}.json`),'utf8'));
const metadata=raw.metadata||JSON.parse(raw.rawMetadata);
const {compilationTarget,...settings}=metadata.settings;
const [[sourcePath,targetName]]=Object.entries(compilationTarget);
if(targetName!==values.contract) fail('Unexpected compilation target.');
const sources=Object.fromEntries(await Promise.all(Object.keys(metadata.sources).map(async path=>[path,{content:await readFile(resolve(root,path),'utf8')}])));
const standardInput={language:'Solidity',sources,settings:{...settings,outputSelection:{'*':{'*':['evm.deployedBytecode']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(standardInput)));
const errors=(output.errors||[]).filter(e=>e.severity==='error');
if(errors.length) fail(errors.map(e=>e.formattedMessage).join('\n'));
const compiled='0x'+output.contracts[sourcePath][values.contract].evm.deployedBytecode.object;
const publicClient=createPublicClient({transport:http(rpc)});
const onchain=await publicClient.getCode({address:values.address});
if(!onchain||onchain==='0x') fail('No deployed bytecode at this address.');
const expected=Buffer.from(compiled.slice(2),'hex'),actual=Buffer.from(onchain.slice(2),'hex');
if(expected.length!==actual.length) fail('Runtime length does not match the reviewed artifact.');
for(const refs of Object.values(raw.deployedBytecode.immutableReferences||{})) for(const {start,length} of refs){expected.fill(0,start,start+length);actual.fill(0,start,start+length);}
if(!actual.equals(expected)) fail('Runtime differs outside declared immutable constructor fields.');
const response=await fetch(`${api}/v2/verify/4663/${values.address}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stdJsonInput:standardInput,compilerVersion:metadata.compiler.version,contractIdentifier:`${sourcePath}:${values.contract}`,creationTransactionHash:values['creation-tx']}),signal:AbortSignal.timeout(30000)});
const body=await response.text();
console.log(JSON.stringify({contract:values.contract,address:values.address,creationTransactionHash:values['creation-tx'],runtimeMatch:'exact except declared immutables',sourceInputHash:keccak256(toHex(JSON.stringify(standardInput))),httpStatus:response.status,response:JSON.parse(body)},null,2));
