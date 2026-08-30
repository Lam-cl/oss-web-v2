const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const js = read('public/merdeka-promo-embed/v1/app.js');
const css = read('public/merdeka-promo-embed/v1/app.css');
const snippet = read('public/merdeka-promo-embed/v1/webflow-snippet.html');
const shared = read('src/app/api/merdeka-promo/shared.ts');
const confirmation = read('src/app/api/merdeka-promo/confirmation/route.ts');
const embedConfirmation = read('src/embed/MerdekaEmbedConfirmation.tsx');
const originalConfirmation = read('src/app/merdeka-promo/confirmation/page.tsx');
const build = read('scripts/build-merdeka-embed.sh');
const chrome = read('src/embed/MerdekaEmbedChrome.tsx');
const chromeCss = read('src/embed/MerdekaEmbedChrome.module.css');
const balamWatchdog = read('public/merdeka-promo-embed/v1/tonewow-balam-launcher-watchdog-v5.js');
const balamHead = read('public/merdeka-promo-embed/v1/webflow-global-head-balam.html');

assert(js.length > 100_000 && js.length < 350_000, 'Embed bundle size is outside the reviewed range.');
assert(css.length > 15_000 && css.length < 80_000, 'Embed stylesheet size is outside the reviewed range.');
for (const value of ['tonewow-merdeka-promo', '/merdeka-promo-api/plans', '/merdeka-promo-api/member', '/merdeka-promo-api/checkout', '/merdeka-promo-api/status']) assert(js.includes(value), `Embed bundle is missing ${value}.`);
for (const forbidden of ['index-body.html', 'bijakbuatduit.com', '<iframe']) assert(!js.includes(forbidden) && !snippet.includes(forbidden), `Embed contains forbidden legacy dependency ${forbidden}.`);
assert(build.includes('--jsx=automatic'), 'Embed build must use the self-contained automatic JSX runtime.');
assert(!js.includes('React.createElement'), 'Embed bundle must not depend on a global React object.');
for (const forbidden of ['aria-label="Primary navigation"', 'aria-label="Cart"', 'aria-label="Open menu"']) assert(!chrome.includes(forbidden), `Merdeka embed header must remain logo-only: ${forbidden}.`);
for (const value of ['position:sticky', 'padding:12px 20px', 'max-width:1200px', 'height:32px', 'justify-content:center', '@media(max-width:768px)']) assert(chromeCss.includes(value), `Embed header styling is missing ${value}.`);
assert(snippet.includes('https://tonewow.xifuhalim.com/merdeka-promo-embed/v1/app.js?v=20260828'));
assert(snippet.includes('public-page="https://www.tonewow.com/malaysia-promo"'));
assert(shared.includes("'https://tonewow.com'") && shared.includes("'https://www.tonewow.com'"));
assert(shared.includes("new URL('https://www.tonewow.com/malaysia-promo')"));
assert(confirmation.includes('const target = merdekaPublicPage();'));
assert(embedConfirmation.includes("status==='success'&&<a href={merdekaPublicPageUrl()}>Back to Home</a>"), 'Webflow payment success must return to the configured campaign page.');
assert(!embedConfirmation.includes('href="https://www.tonewow.com/"'), 'Webflow payment success must not return to the generic homepage.');
assert(originalConfirmation.includes('href="https://www.tonewow.com/malaysia-promo"'), 'Original payment confirmation must return to the Webflow campaign page.');
for (const value of ['Assistant-Shadow-Host', "mode: 'open'", 'data-tonewow-balam-launcher', 'https://tonewow.xifuhalim.com/images/balam-tonewow-chat.svg', "assetState = 'failed'", "visibility', 'visible'"]) assert(balamWatchdog.includes(value), `Webflow Balam watchdog is missing ${value}.`);
const watchdogPosition = balamHead.indexOf('tonewow-balam-launcher-watchdog-v5.js');
const providerPosition = balamHead.indexOf('https://widget.ibalam.ai/assistant');
assert(watchdogPosition >= 0 && providerPosition > watchdogPosition, 'Webflow Balam watchdog must load before the provider.');
assert(balamHead.includes('data-balam-assistant="10682d00-7c37-4ec8-95e6-22aeb9e94b49"'), 'Webflow Balam assistant ID changed unexpectedly.');
for (const route of ['plans','member','checkout','status']) {
  const source = read(`src/app/merdeka-promo-api/${route}/route.ts`);
  assert(source.includes('OPTIONS'), `${route} public alias must export OPTIONS.`);
}
process.stdout.write('Merdeka Webflow embed checks passed.\n');
