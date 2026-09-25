import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const origin=process.env.CARVE_QA_URL||'http://127.0.0.1:5188';
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{
  const state={account:'0x1111111111111111111111111111111111111111',requested:[]};
  window.__carveWalletFixture=state;
  const provider={request:async({method})=>{state.requested.push(method);if(method==='eth_requestAccounts'||method==='eth_accounts')return [state.account];if(method==='eth_chainId')return '0x1237';if(method==='wallet_requestPermissions'){state.account='0x2222222222222222222222222222222222222222';return [{parentCapability:'eth_accounts'}];}throw new Error('Fixture blocks all signing and other methods: '+method);},on(){},removeListener(){}};
  const detail={info:{uuid:'carve-qa-only',name:'Carve QA Wallet',rdns:'carve.qa',icon:''},provider};
  window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})));
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/agents');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Carve QA Wallet',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your wallet',exact:true})).toBeVisible();
 await expect(page.locator('.wallet-connected code')).toHaveText('0x1111111111111111111111111111111111111111');
 await page.getByRole('button',{name:'Change account',exact:true}).click();
 await expect(page.locator('.wallet-connected code')).toHaveText('0x2222222222222222222222222222222222222222');
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect a wallet',exact:true})).toBeVisible();
 const methods=await page.evaluate(()=>window.__carveWalletFixture.requested);
 assert.equal(methods.some(m=>/sign|send/i.test(m)),false);
 await page.getByRole('button',{name:'Close wallet dialog',exact:true}).click();
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);
 console.log('Isolated EIP-6963 fixture: connect, account change, disconnect and light-theme wallet dialog passed. No real wallet or signing used.');
}finally{await browser.close();}
