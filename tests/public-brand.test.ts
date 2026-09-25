import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('public brand uses the custom domain and official X without footer RPC polling',()=>{
 const app=readFileSync('src/App.tsx','utf8'),html=readFileSync('index.html','utf8');
 assert.ok(app.includes('https://x.com/CarveOnRh'));
 assert.ok(app.includes('https://github.com/Chief-codes/carve-robinhood'));
 assert.ok(!app.includes('RH · BLOCK'));
 assert.ok(!app.includes('verifiedChain'));
 assert.ok(app.includes('<WalletProvider>'));
 assert.ok(html.includes('rel="canonical" href="https://carvelaunch.com/"'));
 assert.ok(html.includes('name="twitter:site" content="@CarveOnRh"'));
 assert.ok(readFileSync('public/brand/carve-mascot-512.png').length>0);
});

test('public Docs cover the new domain, source links and sample-versus-inscribed media',()=>{
 const docs=readFileSync('src/components/DocsPage.tsx','utf8');
 for(const text of ['https://carvelaunch.com/','https://x.com/CarveOnRh','GIF demo','not automatically included','24 KiB','1 MB','resume on the original address'])assert.ok(docs.includes(text),text);
 for(const title of ['Create and launch','images, GIFs, sound','disconnect a wallet','Explore tokens','Buy, sell','automatic buyback','Verify the image','Musebook and agent','export, import','Troubleshooting'])assert.ok(docs.includes(title),title);
 assert.ok(docs.includes('Advanced: check the explorer'));
});
