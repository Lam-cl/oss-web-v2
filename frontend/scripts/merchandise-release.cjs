#!/usr/bin/env node
// Run from the clean release worktree. No merge, force push, or implicit scheduling.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function validateReadiness(plan, now = Date.now()) {
  const sha = /^[a-f0-9]{40}$/;
  if (!sha.test(plan.releaseSha || '') || !sha.test(plan.expectedMain || '')) throw new Error('Pinned release and main SHAs are required');
  if (plan.releaseSha === plan.expectedMain) throw new Error('Release contains no change');
  if (plan.repository !== 'git@github.com:Lam-cl/oss-web-v2.git') throw new Error('Wrong repository');
  if (plan.pushAt !== '2026-09-07T10:30:00+08:00' || plan.deadline !== '2026-09-07T11:00:00+08:00') throw new Error('Wrong release window');
  if (now < Date.parse(plan.pushAt) || now >= Date.parse(plan.deadline)) throw new Error('Outside the approved push window');
  for (const gate of ['testsPassed', 'productionBuildPassed', 'vercelEnvironmentVerified', 'previewSmokePassed', 'rollbackVerified']) {
    if (plan[gate] !== true) throw new Error(`Readiness gate missing: ${gate}`);
  }
  if (!plan.rollbackDeployment || plan.checkoutMode !== 'closed') throw new Error('The 10:30 release must have a rollback and closed checkout');
  const verifiedAt = Date.parse(plan.verifiedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > 12 * 60 * 60 * 1000) throw new Error('Readiness evidence is missing or stale');
}

function run() {
  const [mode, manifest] = process.argv.slice(2);
  if (!['--check', '--execute'].includes(mode) || !manifest) throw new Error('Usage: node scripts/merchandise-release.cjs --check|--execute /absolute/readiness.json');
  if (!require('node:path').isAbsolute(manifest)) throw new Error('Use an absolute readiness manifest path');
  const plan = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  validateReadiness(plan);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 60_000 }).trim();
  if (git('remote', 'get-url', 'origin') !== plan.repository) throw new Error('Remote repository changed');
  if (git('rev-parse', 'HEAD') !== plan.releaseSha) throw new Error('Worktree is not at the pinned release');
  if (git('status', '--porcelain')) throw new Error('Release worktree has unreviewed changes');
  git('merge-base', '--is-ancestor', plan.expectedMain, plan.releaseSha);
  const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  if (remote === plan.releaseSha) { console.log('Release already pushed; no action'); return; }
  if (remote !== plan.expectedMain) throw new Error('Production main advanced; re-review required');
  if (mode === '--check') { console.log('Readiness passed; dry run only, nothing pushed'); return; }
  // Recheck deadline after network operations. Non-fast-forward pushes are rejected by Git.
  validateReadiness(plan);
  git('push', '--porcelain', 'origin', `${plan.releaseSha}:refs/heads/main`);
  console.log(`Pushed ${plan.releaseSha}. Vercel build and production smoke verification are still required.`);
}

module.exports = { validateReadiness };
if (require.main === module) {
  try { run(); } catch (error) { console.error(`RELEASE STOPPED: ${error.message}`); process.exitCode = 1; }
}
