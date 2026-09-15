import test from 'node:test';
import assert from 'node:assert/strict';
import {newDraft,makeAsset} from '../src/lib/assets';
import {v3LaunchPlan} from '../src/lib/v3-launch-plan';
test('any nonempty combination up to 24KiB uses one launch approval',async()=>{
 const kinds=['image','audio','website'] as const,mimes=['image/png','audio/wav','text/html'];
 for(let mask=1;mask<8;mask++){const d=newDraft();for(let i=0;i<3;i++)if(mask&(1<<i))d.assets[kinds[i]]=await makeAsset(kinds[i],'fixture',mimes[i],new Uint8Array(32));assert.equal(v3LaunchPlan(d).transactions,1);assert.equal(v3LaunchPlan(d).inline,true);}
});
test('inline limit is total bytes, not per file; large uploads show an upper bound',async()=>{
 const d=newDraft();d.assets.image=await makeAsset('image','fixture','image/png',new Uint8Array(24576));assert.equal(v3LaunchPlan(d).inline,true);
 d.assets.website=await makeAsset('website','fixture.html','text/html',new Uint8Array(1));assert.equal(v3LaunchPlan(d).inline,false);assert.equal(v3LaunchPlan(d).transactions,6);
 assert.equal(v3LaunchPlan(newDraft()).inline,false);
});
