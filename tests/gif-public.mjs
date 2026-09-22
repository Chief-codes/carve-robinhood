import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage();
 const response=await page.goto('https://carve-robinhood.netlify.app/#/studio');
 assert.equal(response.status(),200);
 const csp=response.headers()['content-security-policy'];
 assert.ok(csp.includes("worker-src 'self' blob:"));
 await page.getByLabel('Upload image',{exact:true}).setInputFiles({name:'animation.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==','base64')});
 await page.locator('.asset-image .asset-ready').waitFor({timeout:45000});
 assert.equal(await page.locator('.asset-image [role="alert"]').count(),0);
 assert.ok(await page.locator('.asset-image img').evaluate(el=>el.complete&&el.naturalWidth>0));
 console.log('Public GIF upload, prepared preview and CSP passed; no wallet or transactions used.');
}finally{await browser.close();}
