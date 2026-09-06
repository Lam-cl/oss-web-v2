const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function monitor(plan,io) {
 const deployment=await io.waitDeployment(plan.releaseSha);
 if(deployment==='pending')return {state:'unverified',reason:'Deployment did not finish within 20 minutes'};
 let reason='Deployment failed';
 if(deployment==='success') {
  for(let attempt=1;attempt<=3;attempt++) {
   try {await io.smoke();return {state:'ready',attempt};}
   catch(error){reason=error.message;io.log(`Smoke attempt ${attempt} failed: ${reason}`);if(attempt<3)await io.delay(15000);}
  }
 }
 if(await io.currentMain()!==plan.releaseSha)return {state:'rollback-blocked',reason:'Main advanced; later developer changes preserved',smokeError:reason};
 await io.rollback(plan.rollbackSha);
 const restored=await io.waitDeployment(plan.rollbackSha);
 if(restored==='success'){await io.baselineSmoke();return {state:'rolled-back',reason};}
 return {state:'rollback-unverified',deployment:restored,reason};
}
async function run(manifest) {
 const plan=JSON.parse(fs.readFileSync(manifest,'utf8'));
 const command=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:60000}).trim();
 const git=(...args)=>command('git',args);
 if(git('remote','get-url','origin')!=='git@github.com:Lam-cl/oss-web-v2.git')throw Error('Wrong repository');
 for(const key of ['releaseSha','rollbackSha','expectedMain'])if(!/^[a-f0-9]{40}$/.test(plan[key]||''))throw Error('Invalid SHA');
 git('merge-base','--is-ancestor',plan.releaseSha,plan.rollbackSha);
 if(git('rev-parse',plan.rollbackSha+'^{tree}')!==git('rev-parse',plan.expectedMain+'^{tree}'))throw Error('Invalid rollback tree');
 const gh=endpoint=>JSON.parse(command('gh',['api','repos/Lam-cl/oss-web-v2/'+endpoint]));
 const waitDeployment=async sha=>{
  const deadline=Date.now()+20*60000;
  while(Date.now()<deadline){
   try {
    const deployments=gh(`deployments?sha=${sha}&environment=Production&per_page=10`);
    const deployment=deployments.find(d=>d.environment==='Production'&&d.sha===sha);
    if(deployment){const status=gh(`deployments/${deployment.id}/statuses`)[0]?.state;console.log('Deployment',deployment.id,status);if(status==='success')return 'success';if(['failure','error'].includes(status))return 'failed';}
   }catch(error){console.log('Deployment status unavailable; retrying');}
   await delay(15000);
  }return 'pending';
 };
 const result=await monitor(plan,{
  waitDeployment,delay,log:console.log,
  currentMain:async()=>git('ls-remote','origin','refs/heads/main').split(/\s/)[0],
  rollback:async sha=>{git('push','origin',`${sha}:refs/heads/main`);console.log('Pushed additive rollback',sha);},
  smoke:async()=>{await require('./smoke-merchandise-release.cjs').smoke('https://shop.tonewow.com');await require('./verify-live-balam.cjs').verify('https://shop.tonewow.com',path.join(path.dirname(manifest),'balam-production.png'));},
  baselineSmoke:async()=>{const r=await fetch('https://shop.tonewow.com/api/settings',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok||(await r.json()).showMerchandise!==false)throw Error('Rollback settings did not match baseline');},
 });
 fs.writeFileSync(path.join(path.dirname(manifest),'deployment-result.json'),JSON.stringify({...result,checkedAt:new Date().toISOString(),releaseSha:plan.releaseSha},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(result));if(result.state!=='ready')process.exitCode=1;
}
module.exports={monitor};
if(require.main===module)run(process.argv[2]).catch(e=>{console.error('MONITOR STOPPED:',e.message);process.exitCode=1;});
