import test from 'node:test';
import assert from 'node:assert/strict';
import {openLaunchAttempt,completeLaunchAttempt,launchAttemptSuffix} from '../src/lib/launch-attempt';
test('same pending attempt resumes; a completed identical draft can launch a fresh token',async()=>{
 const map=new Map<string,unknown>(),store={read:async<T>(k:string)=>map.get(k) as T|undefined,save:async(k:string,v:unknown)=>{map.set(k,v);}};
 let n=0;const next=()=>String(++n),a=await openLaunchAttempt(store,'same-draft',next);
 assert.equal((await openLaunchAttempt(store,'same-draft',next)).id,a.id);
 await completeLaunchAttempt(store,'same-draft',a.id);
 const b=await openLaunchAttempt(store,'same-draft',next);assert.notEqual(a.id,b.id);assert.equal(b.completed,false);
 await completeLaunchAttempt(store,'same-draft',a.id);assert.equal((await openLaunchAttempt(store,'same-draft',next)).id,b.id);
 assert.equal(n,2);
});
test('attempt namespaces keep SDK retries stable and reject invalid identifiers',()=>{
 assert.equal(launchAttemptSuffix(), '');
 assert.equal(launchAttemptSuffix('12345678-abcd-abcd-abcd-123456789abc'),':attempt:12345678-abcd-abcd-abcd-123456789abc');
 assert.throws(()=>launchAttemptSuffix('other:key'));
});
