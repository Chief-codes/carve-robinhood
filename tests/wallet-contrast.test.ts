import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync('src/carve-theme.css','utf8');
const declarations=(selector:string)=>{
 const start=css.indexOf(selector+'{');assert.ok(start>=0,selector);
 return Object.fromEntries(css.slice(start+selector.length+1,css.indexOf('}',start)).split(';').filter(Boolean).map(s=>s.split(':')));
};
const luminance=(hex:string)=>{
 assert.match(hex,/^#[a-f0-9]{6}$/i);
 const rgb=hex.slice(1).match(/../g)!.map(h=>parseInt(h,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
};
test('detected wallet buttons keep readable light-theme contrast in every state',()=>{
 for(const suffix of ['',':hover:not(:disabled)',':disabled']){
  const rule=declarations(':root[data-carve-theme=light] .wallet-list button'+suffix);
  const a=luminance(rule.background),b=luminance(rule.color);
  assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,suffix||'resting');
 }
});
test('wallet dialog is opaque, above review, and has a visible keyboard focus ring',()=>{
 assert.equal(declarations(':root[data-carve-theme=light] .dialog-content').background,'#fafff7');
 assert.equal(declarations('.wallet-dialog-overlay')['z-index'],'102');
 assert.equal(declarations('.wallet-dialog')['z-index'],'103');
 assert.ok(css.includes('.wallet-dialog :is(.wallet-list button,.wallet-install,.dialog-close):focus-visible{outline:2px solid #267e48'));
 const wallet=readFileSync('src/components/WalletDialog.tsx','utf8');
 assert.ok(wallet.includes('className="dialog-content wallet-dialog"'));
 assert.ok(wallet.includes('className="dialog-overlay wallet-dialog-overlay"'));
 assert.ok(wallet.includes('onClick={()=>w.connect(p)}'));
});
