#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const excluded = {
  'check-staging-catalogue-export.cjs': 'Historical live export writes reports and asserts August catalogue IDs; not an offline regression.',
  'campaign/check-merdeka-promo-19-aug.cjs': 'Campaign-only page is not shipped by this production branch. Run in its campaign worktree.',
};
const files = fs.readdirSync('scripts').filter(file => /^check-.*\.(cjs|js)$/.test(file) && file !== 'check-production-suite.cjs' && !excluded[file]).sort();
const results = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join('scripts', file)], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, TONEWOW_DATA_API_URL: '', TONEWOW_DATA_API_TOKEN: '' },
  });
  const passed = result.status === 0;
  results.push({ file, passed, status: result.status, ...(passed ? {} : { output: (result.stderr || result.stdout || result.error?.message || '').slice(0,5000) }) });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`);
}
const summary = { passed: results.filter(r=>r.passed).length, failed: results.filter(r=>!r.passed).length,
  notApplicable: Object.entries(excluded).map(([file,reason])=>({file,reason})), results };
if (process.argv[2]) {
  if (!path.isAbsolute(process.argv[2])) throw new Error('Report path must be absolute');
  fs.writeFileSync(process.argv[2], JSON.stringify(summary,null,2)+'\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ ...summary, results: summary.results.filter(r=>!r.passed) },null,2));
process.exitCode = summary.failed ? 1 : 0;
