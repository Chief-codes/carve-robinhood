import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRejectedRequest} from '../src/lib/rejected-request';
import type {Journal} from '../src/lib/transactions';
const a='0x1111111111111111111111111111111111111111',j:Journal={version:1,account:a,chainId:4663,to:a,data:'0x',value:'0',nonce:11,state:'awaiting-wallet'};
test('only explicit rejection with an unused latest and pending nonce can be cleared',()=>{
 assert.doesNotThrow(()=>checkRejectedRequest(j,a,4663,11,11,true));
 assert.throws(()=>checkRejectedRequest(j,a,4663,11,11,false));
 for(const [latest,pending] of [[12,12],[11,12],[10,11],[10,10]])assert.throws(()=>checkRejectedRequest(j,a,4663,latest,pending,true));
});
test('submitted, confirmed, missing and foreign requests never clear as wallet rejection',()=>{
 for(const state of ['submitted','confirmed','reverted','replaced','rejected'] as const)assert.throws(()=>checkRejectedRequest({...j,state},a,4663,11,11,true));
 assert.throws(()=>checkRejectedRequest({...j,hash:'0x01'},a,4663,11,11,true));
 assert.throws(()=>checkRejectedRequest({...j,nonce:undefined},a,4663,11,11,true));
 assert.throws(()=>checkRejectedRequest(undefined,a,4663,11,11,true));
 assert.throws(()=>checkRejectedRequest(j,'0x2222222222222222222222222222222222222222',4663,11,11,true));
 assert.throws(()=>checkRejectedRequest(j,a,1,11,11,true));
});
