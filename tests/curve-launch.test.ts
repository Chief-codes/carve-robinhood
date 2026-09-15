import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEther} from 'viem';
import {curveInitialMinimum} from '../src/lib/curve-launch';
import {withMigrationHeadroom} from '../src/lib/transactions';
test('creator-chosen dev buys: zero, 0.01 and cap rounding match the curve',()=>{
 assert.equal(curveInitialMinimum(0n,0),0n);
 assert.equal(curveInitialMinimum(parseEther('0.01'),0),10n**27n*99n/16899n);
 assert.equal(curveInitialMinimum(parseEther('0.01'),200),10n**27n*97n/16897n);
 assert.equal(curveInitialMinimum(parseEther('5'),0),10n**27n*5n/7n);
 assert.equal(curveInitialMinimum(parseEther('100'),1000),10n**27n*5n/7n);
 assert.throws(()=>curveInitialMinimum(-1n,0));assert.throws(()=>curveInitialMinimum(1n,1001));
});
test('migration adds bounded gas headroom without changing recipient, calldata or value',async()=>{
 const call={address:'0x0000000000000000000000000000000000000001',abi:[],functionName:'buy',value:100n} as const;
 const session:any={account:call.address,read:{estimateContractGas:async()=>200_000n,getBlock:async()=>({gasLimit:32_000_000n})}};
 assert.deepEqual(await withMigrationHeadroom(session,call),{...call,gas:3_200_000n});
 session.read.estimateContractGas=async()=>29_000_000n;
 await assert.rejects(withMigrationHeadroom(session,call),/budget/);
});
