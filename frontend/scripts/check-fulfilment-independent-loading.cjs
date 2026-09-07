const assert = require('node:assert/strict');
const {callable} = require('./test-source-helpers.cjs');
const file = 'src/components/admin/OrderDrawer.tsx';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject}; };
async function main() {
  const value={id:12,status:'PAID',deliveryOption:'DELIVER',trackingCode:null};
  const sim=deferred(), meta=deferred();
  let courierFails=false;
  const scope={
    loadGeneration:{current:1}, loadController:{current:new AbortController()},
    partVersions:{current:{metadata:0,couriers:0,sims:0,catalogue:0}},
    loadedDetails:{current:{}},courierEdited:{current:{courier:false,tracking:false,date:false}},
    detailState:{},couriers:[],simData:null,metadata:null,courierId:'',trackingNo:'',expectedDeliveryDate:'',
    setDetailState(fn){scope.detailState=fn(scope.detailState)},
    setCouriers(v){scope.couriers=v},setSimData(v){scope.simData=v},setMetadata(v){scope.metadata=v},
    setCourierId(v){scope.courierId=v},setTrackingNo(v){scope.trackingNo=v},setExpectedDeliveryDate(v){scope.expectedDeliveryDate=v},
    setPresentationIndex(){},setSimVariantBindings(){},indexAdminOrderItemPresentations:()=>({}),indexLegacySimVariantBindings:()=>({}),
    CATALOGUE_STOREFRONT_ENDPOINT:'/catalogue',fetch:async()=>{throw Error('catalogue unavailable')},
    adminFetch:async path=>path==='couriers'?(courierFails?Promise.reject(Error('couriers unavailable')):Array.from({length:8},(_,i)=>({id:i+1,name:'Courier '+(i+1)}))):path.includes('sim-assignments')?sim.promise:meta.promise,
  };
  // Shared refs and setters let extracted real component functions use the same fixture state.
  const hydrate=callable(file,'hydrateCourier',scope);scope.hydrateCourier=hydrate;
  const load=callable(file,'loadPart',scope);
  const slowSim=load('sims',value),slowMeta=load('metadata',value);
  await load('couriers',value);
  assert.equal(scope.couriers.length,8);assert.equal(scope.detailState.couriers.status,'ready');assert.equal(scope.detailState.sims.status,'loading');
  scope.courierEdited.current.courier=true;scope.courierEdited.current.tracking=true;
  scope.courierId='7';scope.trackingNo='ADMIN-EDIT';
  meta.resolve({courier:{service:'Courier 2',trackingNo:'OLD',expectedDeliveryDate:'2026-09-10'}});await slowMeta;
  assert.equal(scope.courierId,'7');assert.equal(scope.trackingNo,'ADMIN-EDIT');
  assert.equal(scope.expectedDeliveryDate,'2026-09-10');
  sim.reject(Error('The request timed out. Please try again.'));await slowSim;
  assert.equal(scope.detailState.sims.status,'error');assert.equal(scope.couriers.length,8);
  await load('catalogue',value);assert.equal(scope.detailState.catalogue.status,'error');assert.equal(scope.detailState.couriers.status,'ready');
  courierFails=true;await load('couriers',value);assert.equal(scope.detailState.couriers.status,'error');
  courierFails=false;await load('couriers',value);assert.equal(scope.detailState.couriers.status,'ready');

  // Generation and per-resource versions ignore old responses after switch/close or retry.
  for(const invalidate of [()=>scope.loadGeneration.current++,()=>scope.loadController.current.abort(),()=>scope.partVersions.current.couriers++]){
    scope.loadController.current=new AbortController();const delayed=deferred();
    const pending=callable(file,'loadPart',{...scope,adminFetch:()=>delayed.promise})('couriers',value);
    invalidate();delayed.resolve([{id:99,name:'Stale'}]);await pending;assert.equal(scope.couriers.length,8);
  }
  // Retrying SIM succeeds without refetching or clearing the existing courier choices.
  scope.loadController.current=new AbortController();
  await callable(file,'loadPart',{...scope,adminFetch:async()=>({totalUnits:0,assignments:[]})})('sims',value);
  assert.equal(scope.detailState.sims.status,'ready');assert.equal(scope.simData,null);assert.equal(scope.couriers.length,8);
  for(const simState of ['loading','error']){
    const errors=[];let writes=0;
    const update=callable(file,'statusUpdate',{statusOperationRef:{current:false},order:value,pendingStatus:'SHIPPED',detailState:{sims:{status:simState}},setPendingStatus(){},onError:v=>errors.push(v),adminFetch:async()=>{writes++}});
    await update();assert.equal(writes,0);assert.equal(errors.length,1);
  }
  const incompleteErrors=[];
  await callable(file,'statusUpdate',{statusOperationRef:{current:false},order:value,pendingStatus:'SHIPPED',detailState:{sims:{status:'ready'}},simData:{totalUnits:2,assignedUnits:1},setPendingStatus(){},onError:v=>incompleteErrors.push(v)})();
  assert.match(incompleteErrors[0],/Complete SIM assignments/);
  console.log('Independent fulfilment: delayed/failed SIM, isolated retry, metadata readiness, edit preservation, stale response and shipping guards passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
