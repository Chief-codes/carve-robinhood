/** Deform a single texture with smooth, pinned boundaries. No overlaid pose patches. */
export type MotionArea={x:number;y:number;rx:number;ry:number;dx:number;dy:number};
export function deformTexture(base:ImageData,areas:MotionArea[]):ImageData{
 const {width:w,height:h,data:src}=base,out=new ImageData(new Uint8ClampedArray(src),w,h),dst=out.data;
 for(const a of areas){
  for(let y=Math.max(0,Math.floor(a.y-a.ry));y<Math.min(h-1,a.y+a.ry);y++)for(let x=Math.max(0,Math.floor(a.x-a.rx));x<Math.min(w-1,a.x+a.rx);x++){
   const r=((x-a.x)/a.rx)**2+((y-a.y)/a.ry)**2;if(r>=1)continue;
   const weight=(1-r)**3,sx=Math.max(0,Math.min(w-2,x-a.dx*weight)),sy=Math.max(0,Math.min(h-2,y-a.dy*weight));
   const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,i=(y*w+x)*4,j=(iy*w+ix)*4;
   for(let c=0;c<4;c++)dst[i+c]=(src[j+c]*(1-fx)+src[j+4+c]*fx)*(1-fy)+(src[j+w*4+c]*(1-fx)+src[j+w*4+4+c]*fx)*fy;
  }
 }
 return out;
}
