import {MAX_FILE_BYTES} from './assets';
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/webm':'webm','text/html':'html'};
export function mediaExtension(mime:string){return extensions[mime]||'bin';}
/** Export only after chain byte verification. This is generated locally, not an onchain URI getter. */
export function mediaDataURI(mime:string,bytes:Uint8Array){
 if(!extensions[mime]||!bytes.length||bytes.length>MAX_FILE_BYTES)throw new Error('Unsupported media data URL.');
 const pieces:string[]=[];for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
 return 'data:'+mime+';base64,'+btoa(pieces.join(''));
}
