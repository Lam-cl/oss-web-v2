const assert = require('node:assert/strict');
const { validateReadiness } = require('./merchandise-release.cjs');
const plan = {
  releaseSha: 'a'.repeat(40), expectedMain: 'b'.repeat(40),
  repository: 'git@github.com:Lam-cl/oss-web-v2.git',
  pushAt: '2026-09-07T10:30:00+08:00', deadline: '2026-09-07T11:00:00+08:00',
  verifiedAt: '2026-09-07T10:00:00+08:00', checkoutMode: 'closed', rollbackSha: 'c'.repeat(40),
  testsPassed: true, productionBuildPassed: true, vercelBuildPassed: true, localSmokePassed: true, balamBrowserPassed: true, previewProtectionAccepted: true, rollbackVerified: true,
};
const now = Date.parse(plan.pushAt);
assert.doesNotThrow(() => validateReadiness(plan, now));
for (const gate of ['testsPassed', 'productionBuildPassed', 'vercelBuildPassed', 'localSmokePassed', 'balamBrowserPassed', 'rollbackVerified']) {
  assert.throws(() => validateReadiness({ ...plan, [gate]: false }, now), /Readiness gate/);
}
assert.throws(() => validateReadiness(plan, now - 1), /window/);
assert.throws(() => validateReadiness(plan, Date.parse(plan.deadline)), /window/);
assert.throws(() => validateReadiness({ ...plan, checkoutMode: 'open' }, now), /closed/);
assert.throws(() => validateReadiness({ ...plan, releaseSha: 'main' }, now), /SHAs/);
assert.throws(() => validateReadiness({ ...plan, previewProtectionAccepted: false }, now), /explicitly accepted/);
assert.throws(() => validateReadiness({ ...plan, verifiedAt: 'bad-date' }, now), /stale/);
assert.throws(() => validateReadiness({ ...plan, verifiedAt: '2026-09-06T10:00:00+08:00' }, now), /stale/);
console.log('Pinned release readiness, timing and fail-closed gates passed');
