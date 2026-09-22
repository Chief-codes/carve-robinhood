// Explicit read-only mainnet probe. No signer, broadcast, or wallet access.
import assert from 'node:assert/strict';
import {parseEther,bytesToHex,zeroHash} from 'viem';
import {client,DEPLOYMENT,CURVE_DEPLOYMENT} from '../src/lib/chain';
import {verifyDeployment} from '../src/lib/transactions';
import {AUTO_FACTORY_ABI} from '../src/lib/curve-contracts';
import {curveInitialMinimum} from '../src/lib/curve-launch';
import {quoteTrade,findMarket} from '../src/lib/trading';
const account='0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048' as const;
const session:any={account,read:client,deployment:DEPLOYMENT,isCurrent:()=>true,wallet:{getChainId:async()=>4663,getAddresses:async()=>[account]}};
await verifyDeployment(session);
const gif=Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
const empty={root:zeroHash,mimeType:'',encoding:'',data:'0x' as const};
const assets=[{root:zeroHash,mimeType:'image/gif',encoding:'identity',data:bytesToHex(gif)},empty,{root:zeroHash,mimeType:'text/html',encoding:'identity',data:bytesToHex(new TextEncoder().encode('<!doctype html><h1>Read-only simulation</h1>'))}] as const;
for(const auto of [false,true]){
 const sim=await client.simulateContract({account,stateOverride:[{address:account,balance:parseEther('1')}],address:DEPLOYMENT.factory!,abi:AUTO_FACTORY_ABI,functionName:'launchInline',args:['Carve Read Only','CVREAD',assets,100,auto,curveInitialMinimum(parseEther('0.01'),100),BigInt(Math.floor(Date.now()/1000)+600)],value:parseEther('0.0105')});
 assert.ok(sim.result[0]);console.log('Mainnet eth_call launch simulation passed with simulated sender balance, autoBuyback='+auto);
}
const old='0x2c06a3e230FD4ba9D61Ee247C57879F7f1ae9841' as const;
assert.ok(await findMarket(client,old,CURVE_DEPLOYMENT));
const quote=await quoteTrade(client,old,true,parseEther('0.001'),CURVE_DEPLOYMENT);
assert.ok(quote.amountOut>0n);console.log('Previous token route and nonzero buy quote passed. No transactions sent.');
