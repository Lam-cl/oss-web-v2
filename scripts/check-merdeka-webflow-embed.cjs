const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const js = read('public/merdeka-promo-embed/v1/app.js');
const css = read('public/merdeka-promo-embed/v1/app.css');
const snippet = read('public/merdeka-promo-embed/v1/webflow-snippet.html');
const shared = read('src/app/api/merdeka-promo/shared.ts');
const confirmation = read('src/app/api/merdeka-promo/confirmation/route.ts');

assert(js.length > 100_000 && js.length < 350_000, 'Embed bundle size is outside the reviewed range.');
assert(css.length > 15_000 && css.length < 80_000, 'Embed stylesheet size is outside the reviewed range.');
for (const value of ['tonewow-merdeka-promo', '/merdeka-promo-api/plans', '/merdeka-promo-api/member', '/merdeka-promo-api/checkout', '/merdeka-promo-api/status']) assert(js.includes(value), `Embed bundle is missing ${value}.`);
for (const forbidden of ['index-body.html', 'bijakbuatduit.com', '<iframe']) assert(!js.includes(forbidden) && !snippet.includes(forbidden), `Embed contains forbidden legacy dependency ${forbidden}.`);
assert(snippet.includes('https://tonewow.xifuhalim.com/merdeka-promo-embed/v1/app.js?v=20260828'));
assert(snippet.includes('public-page="https://www.tonewow.com/malaysia-promo"'));
assert(shared.includes("'https://tonewow.com'") && shared.includes("'https://www.tonewow.com'"));
assert(shared.includes("new URL('https://www.tonewow.com/malaysia-promo')"));
assert(confirmation.includes('const target = merdekaPublicPage();'));
for (const route of ['plans','member','checkout','status']) {
  const source = read(`src/app/merdeka-promo-api/${route}/route.ts`);
  assert(source.includes('OPTIONS'), `${route} public alias must export OPTIONS.`);
}
process.stdout.write('Merdeka Webflow embed checks passed.\n');
