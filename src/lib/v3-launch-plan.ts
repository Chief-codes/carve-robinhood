import {planAssets,type Draft} from './assets';
import {INLINE_BYTES} from './v3-contracts';

export function v3LaunchPlan(draft:Draft){
 const plan=planAssets(draft.assets),inline=plan.files>0&&plan.bytes<=INLINE_BYTES;
 return {...plan,inline,transactions:inline?1:plan.uploadTransactions+1};
}
