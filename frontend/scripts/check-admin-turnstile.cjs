const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/admin/turnstile.server.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(output, file);
const { verifyAdminTurnstile } = loaded.exports;
const request = { headers: new Headers({ 'cf-connecting-ip': '203.0.113.10' }) };

(async () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalDataUrl = process.env.TONEWOW_DATA_API_URL;
  const originalDataToken = process.env.TONEWOW_DATA_API_TOKEN;
  let calls = 0;
  try {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TONEWOW_DATA_API_URL;
    delete process.env.TONEWOW_DATA_API_TOKEN;
    assert.deepEqual(await verifyAdminTurnstile(request, 'token'), {
      ok: false, status: 503, message: 'Security verification is temporarily unavailable.',
    });

    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    global.fetch = async (_url, init) => {
      calls += 1;
      assert(init.signal instanceof AbortSignal);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('secret'), 'test-secret');
      assert.equal(body.get('response'), 'valid-token');
      assert.equal(body.get('remoteip'), '203.0.113.10');
      return Response.json({ success: true, hostname: 'shop.tonewow.com', action: 'admin_login' });
    };
    assert.deepEqual(await verifyAdminTurnstile(request, ''), {
      ok: false, status: 400, message: 'Please complete the security verification.',
    });
    assert.equal(calls, 0, 'missing tokens must not reach Cloudflare');
    assert.deepEqual(await verifyAdminTurnstile(request, 'valid-token'), { ok: true });
    assert.equal(calls, 1);

    global.fetch = async () => Response.json({ success: true, hostname: 'xbot.xifuhalim.com', action: 'admin_login' });
    assert.equal((await verifyAdminTurnstile(request, 'valid-token')).ok, false, 'Xbot hostname tokens must not authenticate ToneWOW');
    global.fetch = async () => Response.json({ success: true, hostname: 'tonewow.xifuhalim.com', action: 'other_action' });
    assert.equal((await verifyAdminTurnstile(request, 'valid-token')).ok, false, 'action mismatch must fail');
    global.fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
    assert.equal((await verifyAdminTurnstile(request, 'valid-token')).status, 503);

    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TONEWOW_DATA_API_URL = 'https://data.test/bundleapi/';
    process.env.TONEWOW_DATA_API_TOKEN = 'service-token';
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://data.test/bundleapi/v1/security/turnstile/verify');
      assert.equal(init.headers.authorization, 'Bearer service-token');
      assert.deepEqual(JSON.parse(init.body), { token: 'valid-token', remoteIp: '203.0.113.10' });
      return Response.json({ data: { success: true, hostname: 'tonewow.xifuhalim.com', action: 'admin_login' } });
    };
    assert.deepEqual(await verifyAdminTurnstile(request, 'valid-token'), { ok: true });

    const page = fs.readFileSync(path.join(root, 'src/app/admin/login/page.tsx'), 'utf8');
    assert.match(page, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
    assert.match(page, /action:\s*'admin_login'/);
    assert.match(page, /turnstileToken/);
    assert.match(page, /disabled=\{busy \|\| !turnstileToken\}/);
    assert.match(page, /resetTurnstile\(\)/);

    const loginRoute = fs.readFileSync(path.join(root, 'src/app/api/admin/auth/login/route.ts'), 'utf8');
    assert(loginRoute.indexOf('verifyAdminTurnstile') < loginRoute.indexOf('fetch(`${BUNDLE_API}/auth/login`'), 'Turnstile must be verified before Bundle login');
    console.log('Admin Turnstile check passed');
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    if (originalDataUrl === undefined) delete process.env.TONEWOW_DATA_API_URL;
    else process.env.TONEWOW_DATA_API_URL = originalDataUrl;
    if (originalDataToken === undefined) delete process.env.TONEWOW_DATA_API_TOKEN;
    else process.env.TONEWOW_DATA_API_TOKEN = originalDataToken;
  }
})().catch((error) => { console.error(error); process.exit(1); });
