import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin=process.env.CARVE_QA_URL||'http://127.0.0.1:5188';
const local=new URL(origin).hostname==='127.0.0.1';
const artifacts=new URL('../../../work/carve-design-2026-09-25/qa/',import.meta.url).pathname;
fs.mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('.carve-pose-canvas[data-ready=true]').waitFor({timeout:30000});
 await expect(page.getByRole('heading',{name:'Make culture. Keep it onchain.'})).toBeVisible();
 await page.screenshot({path:artifacts+'home-desktop.png'});
 for(const progress of [.55,.84,.93]){
  await page.locator('.carve-scroll-story').evaluate((el,p)=>{const stage=el.querySelector('.carve-scroll-stage');window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top+(el.offsetHeight-stage.clientHeight)*p);},progress);
  await page.waitForTimeout(500);
 }
 await expect(page.locator('.carve-computer-canvas')).toHaveAttribute('data-ready','true');
 await page.screenshot({path:artifacts+'home-tutorial.png'});
 await page.goto(origin+'/#/agents');
 await expect(page.getByRole('heading',{name:'A conversation. A permanent record.'})).toBeVisible();
 await page.locator('.muse-feed-meta, .muse-empty[role=alert]').waitFor({timeout:30000});
 const livePosts=await page.locator('.muse-feed-grid .muse-post').count();
 console.log(JSON.stringify({check:'live-musebook-ui',posts:livePosts,error:await page.locator('[role=alert]').allTextContents()}));
 assert.ok(livePosts>0,'Real public Musebook posts must load');
 await page.screenshot({path:artifacts+'musebook-desktop.png'});
 await expect(page.getByRole('button',{name:'Choose this muse'}).first()).toBeEnabled({timeout:10000});
 await page.getByRole('button',{name:'Choose this muse'}).first().click();
 await expect(page.getByRole('heading',{name:'Make this record yours.'})).toBeVisible({timeout:30000});
 await expect(page.locator('iframe[title="Agent capsule preview"]')).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue to Create'})).toBeDisabled();
 await page.screenshot({path:artifacts+'musebook-review.png'});
 // Reading/capturing above is local only. Do not republish another muse's posts.
 for(const route of ['studio','library','protocol','docs']){
  await page.goto(origin+'/#/'+route);await page.locator('main h1').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-carve-theme'),'light');
 }
 await page.goto(origin+'/#/explore?token=0x2c06a3e230FD4ba9D61Ee247C57879F7f1ae9841');
 await page.getByRole('heading',{name:'Trade $CVCURVE'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Verify inscription',exact:true}).click();
 await expect(page.locator('.proof-file')).toHaveCount(3,{timeout:60000});
 await page.screenshot({path:artifacts+'token-verification.png',fullPage:true});
 console.log('Live previous token and its three onchain media files verified.');
 for(const width of [390,675,1024,1440]){
  await page.setViewportSize({width,height:900});
  for(const route of ['home','agents','studio','explore','library','protocol','docs']){
   await page.goto(origin+'/#/'+route);await page.locator('main h1').waitFor();await page.waitForTimeout(150);
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+2&&getComputedStyle(el).position!=='fixed';}).slice(0,8).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right}))}));
   assert.ok(dimensions.scroll<=dimensions.width+2,JSON.stringify({route,...dimensions}));
   if(width===390&&['home','agents','studio'].includes(route))await page.screenshot({path:artifacts+route+'-mobile.png'});
  }
 }
 await context.close();
 if(local){
  // Isolated fixture context tests draft staging, never live source publication or wallet spending.
  const fixture=await browser.newContext({viewport:{width:1440,height:1000}});
  const p=await fixture.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/api/musebook**',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Fixture: source unavailable'})}));
  await p.goto(origin+'/#/agents');await p.getByRole('button',{name:'Write an agent profile'}).click();
  await expect(p.getByRole('button',{name:'Archivist',exact:true})).toBeEnabled();await p.getByRole('button',{name:'Archivist',exact:true}).click();
  await expect(p.getByRole('button',{name:'Continue to Create'})).toBeDisabled();
  await p.getByLabel('I reviewed this content').check();await p.getByRole('button',{name:'Continue to Create'}).click();
  await expect(p).toHaveURL(/#\/studio$/);await expect(p.getByText('Agent capsule prepared · inspect or edit →')).toBeVisible();
  const staged=await p.evaluate(async()=>{const {readLocal}=await import('/src/lib/storage.ts');const d=await readLocal('draft');const b=await readLocal('agent-capsule-last-backup');return {website:d?.assets?.website?.name,backup:!!b,autoBuyback:d?.autoBuyback};});
  assert.equal(staged.website,'agent-capsule.html');assert.equal(staged.backup,true);
  await p.reload();await expect(p.getByText('Agent capsule prepared · inspect or edit →')).toBeVisible();
  await fixture.close();console.log('Written profile → exact preview → permission → safe backup → Create → reload passed.');
 }
 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const r=await reduced.newPage();r.on('pageerror',e=>errors.push(e.message));
 await r.goto(origin);await r.locator('.carve-pose-canvas[data-ready=true]').waitFor();await r.getByRole('button',{name:'Scroll with Carve',exact:true}).first().click();
 await expect(r.getByRole('heading',{name:'I’m Carve.'})).toBeVisible();await reduced.close();
 assert.deepEqual(errors,[]);console.log('Design/Musebook browser checks passed; no wallet signatures or chain writes.');
}finally{await browser.close();}
