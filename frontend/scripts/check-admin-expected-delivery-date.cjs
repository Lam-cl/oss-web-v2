const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/components/admin/OrderDrawer.tsx','utf8');
assert.equal(source.includes("const [expectedDeliveryDate,setExpectedDeliveryDate]=useState('');"),true,'local expected date state missing');
assert.equal(source.includes('<label className="adm-field">Expected delivery date<input type="date" value={expectedDeliveryDate}'),true,'delivery-only expected date field missing');
assert.equal(source.includes('expectedDeliveryDate})'),true,'expected date must be persisted to staging metadata');
assert.equal(source.includes("courierBusy?'Saving…':'Save'"),true,'courier Save action missing');
console.log('admin expected delivery date regression check passed');
