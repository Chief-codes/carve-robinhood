#!/usr/bin/env node
// Official public source-verification API only: no wallet, key, signing or transaction RPC.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {prepareSourceVerification} from './verify-blockscout.mjs';
const API='https://sourcify.dev/server';
function check(ok,message){if(!ok)throw new Error(message);}
export async function sourcifyRequest(path,payload){
 check(path.startsWith('/v2/verify/')||path.startsWith('/v2/contract/')||path==='/chains','Unsupported verification API path.');
 const response=await fetch(API+path,{method:payload?'POST':'GET',
  ...(payload?{headers:{'content-type':'application/json'},body:JSON.stringify(payload)}:{}),
  signal:AbortSignal.timeout(30000)});
 const text=await response.text();let result;try{result=JSON.parse(text);}catch{result={message:text.slice(0,2000)};}
 return {checkedAt:new Date().toISOString(),url:API+path,httpStatus:response.status,result};
}
export async function submitSourcify(prepared,creationTransactionHash){
 check(/^0x[a-fA-F0-9]{40}$/.test(prepared.address),'Invalid contract address.');
 check(/^0x[a-f0-9]{64}$/.test(creationTransactionHash),'Provide the exact creation transaction hash.');
 check(prepared.locallyReproduced===true,'Exact local compiler reproduction is required.');
 return sourcifyRequest(`/v2/verify/4663/${prepared.address}`,{
  stdJsonInput:prepared.standardInput,compilerVersion:prepared.compilerVersion.replace(/^v/,''),
  contractIdentifier:prepared.contractName,creationTransactionHash,
 });
}
async function main(){
 const {values}=parseArgs({options:{contract:{type:'string'},plan:{type:'string'},verified:{type:'string'},
  'creation-tx':{type:'string'},submit:{type:'boolean',default:false},job:{type:'string'},lookup:{type:'string'}}});
 if(values.job){
  check(/^[0-9a-f-]{36}$/i.test(values.job),'Invalid verification job ID.');
  console.log(JSON.stringify(await sourcifyRequest('/v2/verify/'+values.job),null,2));return;
 }
 if(values.lookup){
  check(/^0x[a-fA-F0-9]{40}$/.test(values.lookup),'Invalid lookup address.');
  console.log(JSON.stringify(await sourcifyRequest('/v2/contract/4663/'+values.lookup),null,2));return;
 }
 check(values.contract&&values.plan&&values.verified,'Provide --contract FIELD --plan PLAN --verified REPORT [--creation-tx HASH --submit].');
 const prepared=await prepareSourceVerification(values.contract,{planPath:values.plan,verifiedPath:values.verified});
 const {standardInput,...summary}=prepared;
 console.log(JSON.stringify({...summary,creationTransactionHash:values['creation-tx'],
  verification:values.submit?await submitSourcify(prepared,values['creation-tx']):{status:'prepared-not-submitted'}},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{console.error(String(error.message||error));process.exitCode=1;});
