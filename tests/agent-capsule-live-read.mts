// Read-only mainnet compatibility check. Never signs or broadcasts.
import assert from 'node:assert/strict';
import {bytesToHex,parseEther,zeroHash} from 'viem';
import {client,DEPLOYMENT} from '../src/lib/chain';
import {AUTO_FACTORY_ABI} from '../src/lib/curve-contracts';
import {prepareCapsule,readCapsuleHTML} from '../src/lib/agent-capsule';
import {validateMediaBytes} from '../src/lib/inscriptions';
const {asset}=await prepareCapsule({name:'Capsule simulation',purpose:'Read-only compatibility test. Not a published agent.',personality:'',instructions:'Never claim a simulated transaction was mined.',source:null});
validateMediaBytes(asset);assert.ok(readCapsuleHTML(asset.bytes));
const empty={root:zeroHash,mimeType:'',encoding:'',data:'0x' as const};
const account='0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048' as const;
const simulation=await client.simulateContract({account,stateOverride:[{address:account,balance:parseEther('1')}],address:DEPLOYMENT.factory!,abi:AUTO_FACTORY_ABI,functionName:'launchInline',args:['Capsule Read Only','CAPREAD',[empty,empty,{root:zeroHash,mimeType:'text/html',encoding:'identity',data:bytesToHex(asset.bytes)}],0,false,0n,BigInt(Math.floor(Date.now()/1000)+600)],value:parseEther('0.0005')});
assert.ok(simulation.result[0]);console.log(JSON.stringify({check:'deployed-v5-capsule-launch',success:true,bytes:asset.bytes.length,chainId:4663,factory:DEPLOYMENT.factory,method:'eth_call',simulatedSenderBalance:true,broadcast:false}));
