// Mechanical web-asset compression only; original artwork stays untouched.
// Usage: SHARP_MODULE=/path/to/sharp node scripts/prepare-buddy-assets.mjs
import {createRequire} from 'node:module';
import {mkdir,stat} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE||'sharp');
await mkdir('src/assets/buddy',{recursive:true});
const jobs=[
 ['public/brand/carve-mascot-512.png','buddy',512],
 ['public/brand/scroll-sequence/jump.png','jump',1254],
 ['public/brand/scroll-sequence/walk-right.png','walk',1254],
 ['public/brand/scroll-sequence/sit-magic.png','sit',1254],
 ['public/brand/scroll-sequence/gaze-eyes-25.png','eyes',1254],
 ['public/brand/carve-leaning-v2.png','leaning',1254],
 ['public/brand/carve-computer-hd-v2.png','computer',1254],
 ['public/brand/carve-computer-clean-v3.png','computer-plate',1254],
 ['public/tutorial/carve-launch-poster.png','tutorial-poster',800],
];
for(const [input,name,width] of jobs){
 const output=`src/assets/buddy/${name}.webp`;
 // Preserve original character pixels/alpha. Speed comes from deferred loading,
 // not lossy facial detail or reducing the later scenes' native resolution.
 await sharp(input).resize({width,withoutEnlargement:true}).webp({lossless:true,effort:6}).toFile(output);
 console.log(`${name}: ${(await stat(input)).size} → ${(await stat(output)).size} bytes`);
}
