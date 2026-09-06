const assert=require('node:assert/strict');
const {monitor}=require('./monitor-merchandise-release.cjs');
(async()=>{
 const plan={releaseSha:'release',rollbackSha:'rollback'};
 const run=async(options={})=>{let tries=0,pushes=0;const io={waitDeployment:async()=>options.deployment||'success',smoke:async()=>{tries++;if(options.badSmoke)throw Error('bad icon');},currentMain:async()=>options.advanced?'someone-else':'release',rollback:async()=>{pushes++;},baselineSmoke:async()=>{},delay:async()=>{},log:()=>{}};return {result:await monitor(plan,io),tries,pushes};};
 let value=await run();assert.equal(value.result.state,'ready');assert.equal(value.pushes,0);
 value=await run({badSmoke:true});assert.equal(value.result.state,'rolled-back');assert.equal(value.tries,3);assert.equal(value.pushes,1);
 value=await run({badSmoke:true,advanced:true});assert.equal(value.result.state,'rollback-blocked');assert.equal(value.pushes,0);
 value=await run({deployment:'pending'});assert.equal(value.result.state,'unverified');assert.equal(value.pushes,0);
 value=await run({deployment:'failed'});assert.equal(value.result.state,'rollback-unverified');assert.equal(value.pushes,1);
 console.log('Release monitor: success, retries, rollback, advanced main and pending deployment passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
