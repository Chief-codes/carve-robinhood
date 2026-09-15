import {keccak256,parseEther,type PublicClient,type Address} from 'viem';
import {type Deployment} from './chain';
import {V3_CANONICAL,V3_FACTORY_ABI,V3_LOCKER_ABI,V3_BINDING_ABI} from './v3-contracts';
import {verifyCanonical} from './v3-trading-core';
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const recipient='0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048';
export async function verifyV3Release(read:PublicClient,d:Deployment&{registry:Address;factory:Address;engine:Address;router:Address}){
 if(d.kind!=='v3'||d.status!=='verified'||d.chainId!==4663||!same(d.router,V3_CANONICAL.router))throw new Error('Incorrect V3 deployment configuration.');
 const blockNumber=await read.getBlockNumber();
 await verifyCanonical(read,blockNumber);
 await Promise.all((['registry','factory','engine','router'] as const).map(async key=>{
  const expected=d.codeHashes?.[key],code=await read.getCode({address:d[key],blockNumber});
  if(!expected||!code||code==='0x'||keccak256(code)!==expected)throw new Error('The '+key+' runtime does not match this verified release.');
 }));
 const f=(functionName:'registry'|'locker'|'platformRecipient'|'creationFee'|'supply'|'poolFee'|'milestoneETH')=>read.readContract({address:d.factory,abi:V3_FACTORY_ABI,functionName,blockNumber});
 const [registry,locker,platform,fee,supply,poolFee,milestone,factory,receiver,rf,rw,mf,mw]=await Promise.all([
  f('registry'),f('locker'),f('platformRecipient'),f('creationFee'),f('supply'),f('poolFee'),f('milestoneETH'),
  read.readContract({address:d.engine,abi:V3_LOCKER_ABI,functionName:'launchFactory',blockNumber}),
  read.readContract({address:d.engine,abi:V3_LOCKER_ABI,functionName:'platformRecipient',blockNumber}),
  read.readContract({address:d.router,abi:V3_BINDING_ABI,functionName:'factory',blockNumber}),
  read.readContract({address:d.router,abi:V3_BINDING_ABI,functionName:'WETH9',blockNumber}),
  read.readContract({address:V3_CANONICAL.manager,abi:V3_BINDING_ABI,functionName:'factory',blockNumber}),
  read.readContract({address:V3_CANONICAL.manager,abi:V3_BINDING_ABI,functionName:'WETH9',blockNumber}),
 ]);
 if(!same(String(registry),d.registry)||!same(String(locker),d.engine)||!same(String(platform),recipient)||!same(factory,d.factory)||!same(receiver,recipient)
  ||fee!==parseEther('0.0005')||supply!==10n**27n||poolFee!==10000||milestone!==parseEther('4.2')
  ||!same(rf,V3_CANONICAL.factory)||!same(mf,V3_CANONICAL.factory)||!same(rw,V3_CANONICAL.weth)||!same(mw,V3_CANONICAL.weth))throw new Error('V3 contract bindings or approved fees changed.');
 return d;
}
