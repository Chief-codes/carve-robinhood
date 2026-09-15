/** Bounded newest-first factory indices. Never convert factory counters to Number. */
export function feedWindow(count:bigint,cursor:bigint|null,size=12){
 if(count<0n||cursor!==null&&(cursor<0n||cursor>count)||!Number.isSafeInteger(size)||size<1||size>60)throw new Error('Invalid launch page');
 const start=cursor??count,end=start>BigInt(size)?start-BigInt(size):0n;
 const indices:bigint[]=[];for(let i=start;i>end;i--)indices.push(i-1n);
 return {indices,cursor:end};
}
/** Updated rows replace by immutable factory index; old rows survive live refreshes. */
export function mergeFeed<T extends {index:bigint;token:string}>(old:readonly T[],updated:readonly T[],count:bigint){
 const rows=new Map<bigint,T>();for(const row of [...old,...updated])if(row.index>=0n&&row.index<count)rows.set(row.index,row);
 const tokens=new Set<string>();return [...rows.values()].sort((a,b)=>a.index>b.index?-1:a.index<b.index?1:0).filter(row=>{const key=row.token.toLowerCase();if(tokens.has(key))return false;tokens.add(key);return true;});
}
