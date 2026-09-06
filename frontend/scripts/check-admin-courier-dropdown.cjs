const assert=require('node:assert/strict');
const {parse,find,ts,elements,attribute}=require('./test-source-helpers.cjs');
const tree=parse('src/components/admin/OrderDrawer.tsx');
assert(find(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='adminFetch'&&n.arguments[0]?.text==='couriers').length, 'Courier options must be loaded from the provider');
const options=elements(tree,'option').filter(n=>attribute(n,'value',tree)?.expression?.getText(tree)==='courier.id');
assert.equal(options.length,1,'Courier values use stable provider IDs');
require('./test-courier-behavior.cjs')().then(()=>console.log('Courier loading, IDs, validation and provider payload passed')).catch(e=>{console.error(e);process.exitCode=1;});
