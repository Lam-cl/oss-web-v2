const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/checkout/page.tsx','utf8');
for(const name of ['lastName','phone']) {
  const input=source.match(new RegExp(`<input name=\"${name}\"[^>]*>`))?.[0]||'';
  assert.match(input,/\brequired\b/,name+' input must be browser-required');
}
assert.match(source,/Last Name <span style=\{\{ color: '#ef4444' \}\}>\*<\/span>/,'Last Name must show red asterisk');
assert.match(source,/Phone <span style=\{\{ color: '#ef4444' \}\}>\*<\/span>/,'Phone must show red asterisk');
assert.match(source,/!form\.firstName \|\| !form\.lastName \|\| !form\.email \|\| !form\.phone \|\| !form\.ic/,'submit validation must require Last Name and Phone');
console.log('checkout required identity fields check passed');
