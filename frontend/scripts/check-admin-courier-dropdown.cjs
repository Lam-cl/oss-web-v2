const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/admin/OrderDrawer.tsx','utf8');
assert(!source.includes("const couriers=['City Link'"),'couriers must not be hardcoded');
assert(source.includes("adminFetch<Courier[]>('couriers')"),'live courier load missing');
assert(source.includes('option key={courier.id} value={courier.id}'),'courier dropdown must use stable Courier ID');
assert(source.includes('trackingCode:trackingNo.trim()'),'Bundle tracking payload missing');
assert(source.includes('courierId:Number(courierId)'),'Bundle courier ID payload missing');
assert(source.includes("courierBusy?'Saving…':'Save'"),'Courier Save action missing');
console.log('admin courier dropdown regression check passed');
