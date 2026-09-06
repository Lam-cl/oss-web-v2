const assert=require('node:assert/strict'),fs=require('node:fs');
assert(fs.existsSync('public/images/balam-tonewow-chat.svg'),'Configured launcher image must exist');
const source=fs.readFileSync('src/components/layout/RouteChrome.tsx','utf8');
assert(source.includes("CHAT_PROVIDER==='balam'?"),'Only the selected provider is mounted');
require('./test-balam-behavior.cjs')('/');
console.log('Current Balam branding, idempotence, host replacement and observer cleanup passed');
