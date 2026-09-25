import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buddyBlink,gazeIndex} from '../src/components/buddy-face';

test('the original 5 by 5 gaze map covers all 25 poses and neutral is 12',()=>{
 assert.equal(gazeIndex(-1,0),10);assert.equal(gazeIndex(1,0),14);
 assert.equal(gazeIndex(0,-1),2);assert.equal(gazeIndex(0,1),22);assert.equal(gazeIndex(0,0),12);
 const poses=new Set<number>();for(const y of [-1,-.5,0,.5,1])for(const x of [-1,-.5,0,.5,1])poses.add(gazeIndex(x,y));
 assert.equal(poses.size,25);assert.equal(gazeIndex(-100,100),20);assert.equal(gazeIndex(100,-100),4);
});
test('blink matches the friend recording sine timing and restores the open face',()=>{
 assert.equal(buddyBlink(0).amount,0);assert.equal(buddyBlink(470).amount,0);assert.equal(buddyBlink(585).amount,1);assert.equal(buddyBlink(700).amount,0);
 for(let t=0;t<12000;t++){
  const phase=(t+4700)%5400,expected=phase>5170?Math.sin((phase-5170)/230*Math.PI):0;
  assert.equal(buddyBlink(t).amount,expected);assert.ok(buddyBlink(t).delay>=16);
  assert.ok(Math.abs(buddyBlink(t).amount-buddyBlink(t+5400).amount)<1e-10);
 }
});
test('original eye artwork is unchanged and its lossless derivative is bounded',()=>{
 const image=readFileSync('public/brand/scroll-sequence/gaze-eyes-25.png');
 assert.equal(createHash('sha256').update(image).digest('hex'),'75f10154f0b21d5ccbcc3b5be2c71407c670e8b060b6b634916919f8af9fa1bd');
 assert.ok(readFileSync('src/assets/buddy/eyes.webp').includes(Buffer.from('VP8L')));
 assert.ok(statSync('src/assets/buddy/eyes.webp').size<750000);
 const source=readFileSync('src/components/CarveScrollMascot.ts','utf8');
 assert.match(source,/showGaze=pose.phase==='seated'/);assert.match(source,/drawGaze\(ctx,f,gaze!,index\)/);
 assert.doesNotMatch(source,/renderBuddyFace/);assert.match(source,/finePointer.matches&&!reduced.matches&&pointer.inside/);
 assert.match(source,/pointerdown/);assert.match(source,/document.documentElement.removeEventListener\('pointerleave'/);
});
