import type {Journal} from './transactions';
/** This is a user-confirmed rejection, not proof that an unknown broadcast was cancelled. */
export function checkRejectedRequest(j:Journal|undefined,account:string,chainId:number,latest:number,pending:number,userConfirmed:boolean){
 if(!userConfirmed)throw new Error('First confirm that you rejected the request in your wallet.');
 if(!j||j.account.toLowerCase()!==account.toLowerCase()||j.chainId!==chainId)throw new Error('This request belongs to another wallet or chain.');
 if(j.state!=='awaiting-wallet'||j.hash||j.nonce===undefined)throw new Error('This request may have been submitted. Verify its transaction hash instead.');
 if(latest!==j.nonce||pending!==j.nonce)throw new Error('The wallet nonce has changed or has a pending transaction. Verify its hash instead.');
}
