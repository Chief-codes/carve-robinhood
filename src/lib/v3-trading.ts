import {type Abi,type Address,type PublicClient} from 'viem';
import {DEPLOYMENT,type Deployment} from './chain';
import {assertSession,sendChecked,type Session} from './transactions';
import * as core from './v3-trading-core';
export type V3Quote=core.TradeQuote;
export type V3Snapshot=core.Snapshot;
export function v3Config(d:Deployment=DEPLOYMENT):core.Deployment{
 if(d.kind!=='v3'||d.status!=='verified'||!d.factory||!d.registry||!d.codeHashes?.factory||!d.codeHashes?.engine)throw new Error('The V3 deployment is not verified yet.');
 return{factory:d.factory,registry:d.registry,factoryCodeHash:d.codeHashes.factory,lockerCodeHash:d.codeHashes.engine,platformRecipient:'0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048'};
}
export const readV3Market=(read:PublicClient,token:Address,d=DEPLOYMENT,block?:bigint)=>core.readMarket(read,token,v3Config(d),block);
export const quoteV3=(read:PublicClient,token:Address,buy:boolean,amount:bigint,d=DEPLOYMENT)=>core.quoteTrade(read,token,buy,amount,v3Config(d));
export async function executeV3(s:Session,q:V3Quote,bps:number){
 return core.executeTrade({read:s.read,account:s.account,deployment:v3Config(s.deployment||DEPLOYMENT),assertCurrent:async()=>{await assertSession(s);},sendChecked:(call,key)=>sendChecked(s,{...call,abi:call.abi as Abi},key)},q,bps);
}
export async function unwrapWETH(s:Session,amount:bigint){const call=core.prepareWethWithdrawal(amount);return sendChecked(s,{...call,abi:call.abi as Abi});}
