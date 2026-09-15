import {encodeAbiParameters,parseAbiParameters,keccak256,hexToBytes,bytesToHex,type Address,type Hex,type PublicClient} from 'viem';
import {REGISTRY_ABI} from './chain';
import {MAX_FILE_BYTES,CHUNK_BYTES,externalReferences,type ContentAsset} from './assets';

const manifestTypes=parseAbiParameters('uint8,string,string,uint256,address[],bytes32[]');
export function contentRoot(mime:string,encoding:string,length:bigint,pointers:readonly Address[],hashes:readonly Hex[]) {
 return keccak256(encodeAbiParameters(manifestTypes,[1,mime,encoding,length,pointers,hashes]));
}
export function validateMediaBytes(asset:Pick<ContentAsset,'kind'|'mime'|'bytes'>){
 if(!asset.bytes.length||asset.bytes.length>MAX_FILE_BYTES)throw new Error('The prepared file must contain between 1 byte and 1 MB.');
 if((asset.kind==='image'&&!asset.mime.startsWith('image/'))||(asset.kind==='audio'&&!asset.mime.startsWith('audio/'))||(asset.kind==='website'&&asset.mime!=='text/html'))throw new Error('Media type does not match its inscription slot.');
 const b=asset.bytes, ascii=(start:number,end:number)=>String.fromCharCode(...b.slice(start,end));
 const hex=bytesToHex(b.slice(0,8));let valid=false;
 switch(asset.mime){
 case 'image/png':valid=hex==='0x89504e470d0a1a0a';break;
 case 'image/jpeg':valid=b[0]===255&&b[1]===216&&b[2]===255;break;
 case 'image/webp':valid=ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';break;
 case 'image/gif':valid=['GIF87a','GIF89a'].includes(ascii(0,6));break;
 case 'audio/mpeg':valid=ascii(0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224);break;
 case 'audio/mp4':valid=ascii(4,8)==='ftyp';break;
 case 'audio/wav':case 'audio/x-wav':valid=ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE';break;
 case 'audio/ogg':valid=ascii(0,4)==='OggS';break;
 case 'audio/webm':valid=bytesToHex(b.slice(0,4))==='0x1a45dfa3';break;
 case 'text/html':{
  const html=new TextDecoder('utf-8',{fatal:true}).decode(b);
  if(externalReferences(html).length)throw new Error('Embed the website’s external resources before inscribing it.');
  valid=html.trim().length>0&&!html.includes('\u0000');break;
 }
 }
 if(!valid)throw new Error('The file bytes do not match the selected media type.');
}
export async function readPointer(read:PublicClient,pointer:Address,hash:Hex){
 const code=await read.getCode({address:pointer});
 if(!code||!code.startsWith('0x00')||code.length<=4||code.length>2+(CHUNK_BYTES+1)*2)throw new Error('Invalid onchain data chunk.');
 const bytes=hexToBytes(('0x'+code.slice(4)) as Hex);
 if(keccak256(bytes)!==hash)throw new Error('Chunk integrity check failed.');
 return bytes;
}
export async function decodeBoundedGzip(bytes:Uint8Array){
 if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot safely verify gzip content. Use a current browser.');
 const pieces:Uint8Array[]=[];let size=0;
 const reader=new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE_BYTES)throw new Error('Decompressed content exceeds the safety limit.');pieces.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const p of pieces){result.set(p,offset);offset+=p.length;}return result;
}
export async function reconstructContent(read:PublicClient,registry:Address,root:Hex){
 const [version,mime,encoding,length,creator,pointers,hashes]=await read.readContract({address:registry,abi:REGISTRY_ABI,functionName:'getContent',args:[root]});
 if(version!==1||length===0n||length>BigInt(MAX_FILE_BYTES)||!pointers.length||pointers.length>128
  ||pointers.length!==hashes.length||!['identity','gzip'].includes(encoding)
  ||contentRoot(mime,encoding,length,pointers,hashes)!==root)throw new Error('Invalid content manifest.');
 const encoded=new Uint8Array(Number(length));let offset=0;
 for(let i=0;i<pointers.length;i++){
  const bytes=await readPointer(read,pointers[i],hashes[i]);
  if(offset+bytes.length>encoded.length)throw new Error('Content length mismatch.');
  encoded.set(bytes,offset);offset+=bytes.length;
 }
 if(offset!==encoded.length)throw new Error('Content length mismatch.');
 const bytes=encoding==='gzip'?await decodeBoundedGzip(encoded):encoded;
 return {root,registry,creator,mime,encoding,bytes,encodedByteLength:length.toString(),chunkHashes:[...hashes],encodedHash:keccak256(encoded),hash:keccak256(bytes),pointers:[...pointers]};
}
