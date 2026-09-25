import buddy from '../assets/buddy/buddy.webp';
import jump from '../assets/buddy/jump.webp';
import walk from '../assets/buddy/walk.webp';
import sit from '../assets/buddy/sit.webp';
import leaning from '../assets/buddy/leaning.webp';
import computer from '../assets/buddy/computer.webp';
import plate from '../assets/buddy/computer-plate.webp';
import poster from '../assets/buddy/tutorial-poster.webp';
import eyes from '../assets/buddy/eyes.webp';

export const buddyAssets={buddy,jump,walk,sit,leaning,computer,plate,poster,eyes};
const images=new Map<string,Promise<HTMLImageElement>>();
/** Decoded image reuse also prevents duplicate StrictMode downloads/work. */
export function loadBuddyImage(src:string){
 let task=images.get(src);
 if(!task){task=new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();image.decoding='async';
  image.onload=()=>{image.decode().catch(()=>{}).then(()=>resolve(image));};
  image.onerror=()=>reject(new Error('Character image unavailable'));image.src=src;
 });images.set(src,task);task.catch(()=>images.delete(src));}
 return task;
}

export {visibleAnimation} from './animation-scheduler';
