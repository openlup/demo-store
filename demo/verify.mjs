import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'); process.chdir(root);
const context = resolve(root, '.context'); mkdirSync(context, { recursive: true, mode: 0o700 });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const origin = json('.starter-origin.json'), application = json('package.json');
const receipt = { schemaVersion: 1, description: 'OpenLup first-party demo store',
  qualification: `published ${application.dependencies['@openlup/core']} set; application verification only; original extraction retained`,
  setVersion: application.dependencies['@openlup/core'], lockfileSha256: sha(readFileSync('package-lock.json')), extraction: origin,
  node: process.version, postgresImage: json('demo/images.json').postgres, startedAt: new Date().toISOString(), results: [], result: 'FAIL' };
const save = () => writeFileSync(resolve(context, 'ci-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
let failed = false;
function check(name, cmd, args, heavy = false) {
  const start = performance.now(); let code = null, blocked = false;
  const log = openSync(resolve(context, `${name}.private.log`), 'w', 0o600);
  try {
    let load15 = null;
    if (heavy) {
      if (process.platform === 'darwin') {
        const observed = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim();
        console.log(`load gate: ${observed}`); load15 = Number(observed.replace(/[{}]/g, '').trim().split(/\s+/)[2]);
      } else load15 = loadavg()[2];
      if (!Number.isFinite(load15) || load15 >= 12) { blocked = true; throw new Error('demo_load_gate'); }
    }
    const result = spawnSync(cmd, args, { cwd: root, stdio: ['ignore', log, log] });
    code = result.status;
  } catch { blocked = true; }
  finally { closeSync(log); }
  const result = { name, result: blocked ? 'BLOCKED' : code === 0 ? 'PASS' : 'FAIL', exitCode: code, durationMs: Math.round(performance.now() - start) };
  receipt.results.push(result); save(); console.log(`${name}: ${result.result} (${result.durationMs} ms)`);
  if (code !== 0 || blocked) failed = true;
  return code === 0 && !blocked;
}
try {
  if (!/^\d+\.\d+\.\d+$/.test(receipt.setVersion)
      || (receipt.setVersion === origin.setVersion && receipt.lockfileSha256 !== origin.lockfileSha256)
      || ['@openlup/core','@openlup/outbox','@openlup/platform'].some(name => application.dependencies[name] !== receipt.setVersion)) {
    throw new Error('demo_extraction_identity_mismatch');
  }
  const installed = check('install', 'npm', ['ci'], true);
  if (installed) {
    for (const name of ['core', 'outbox', 'platform']) {
      if (json(`node_modules/@openlup/${name}/package.json`).version !== receipt.setVersion) throw new Error('demo_installed_set_mismatch');
    }
    check('typecheck', 'npm', ['run', 'typecheck'], true);
    check('build', 'npm', ['run', 'build'], true);
    check('application-tests', 'npm', ['test'], true);
    // Authentication is supplied by local Docker login or the workflow's read-only token.
    const pulled = check('postgres-mirror-pull', 'docker', ['pull', receipt.postgresImage]);
    if (pulled) {
      const browser = check('browser-install', 'npx', ['--no', '--', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], true);
      if (browser) check('sandbox-purchase-journey', process.execPath, ['--experimental-strip-types', 'demo/purchase-journey.mjs'], true);
      else receipt.results.push({ name: 'sandbox-purchase-journey', result: 'BLOCKED', reason: 'browser-install', durationMs: 0 });
    } else receipt.results.push({ name: 'sandbox-purchase-journey', result: 'BLOCKED', reason: 'authenticated mirrored PostgreSQL pull failed; no fallback', durationMs: 0 });
  }
} catch (error) { failed = true; receipt.error = error.message; }
finally {
  receipt.endedAt = new Date().toISOString(); receipt.result = failed ? 'FAIL' : 'PASS'; save();
  console.log(`Receipt: .context/ci-receipt.json (${receipt.result})`);
  if (failed) process.exitCode = 1;
}
