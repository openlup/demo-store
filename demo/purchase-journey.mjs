// Application-owned harness of the starter's native purchase journey.
// Engines remain installed npm dependencies. No customer or production fixture.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createPlatformPostgresMigrationRunner, qualifiedPostgresStartupOptions } from '@openlup/platform/migrations';
import { configurations } from '../owned/store.config.ts';
import { applyDemoSeed, demonstrationMarker } from '../installation/install.ts';
import { runDemoSubscriber } from '../owned/settlement-subscriber.ts';
import { createPrivateCapture } from '../host/private-capture.ts';
import { createPostgresOutboxStore } from '@openlup/outbox/postgres';

const root = resolve(import.meta.dirname, '..');
const image = JSON.parse(await readFile(new URL('./images.json', import.meta.url), 'utf8')).postgres;
if (!/^ghcr\.io\/openlup\/library\/postgres:16@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('demo_mirror_pin_required');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const inspect = JSON.parse(docker('image', 'inspect', image))[0];
if (!inspect.RepoDigests.includes(image.replace(':16@', '@'))) throw new Error('demo_mirror_identity_required');
const state = resolve(root, '.context/demo-purchase', randomUUID());
await mkdir(state, { recursive: true, mode: 0o700 });
const containers = [], hosts = [], pools = [], entries = [];
async function command(executable, args) {
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error('demo_journey_command_failed');
}
try {
  for (const config of Object.values(configurations)) {
    const name = `morrow-demo-${process.pid}-${config.id}-${randomUUID().slice(0, 8)}`;
    docker('run', '--pull=never', '--detach', '--name', name, '--tmpfs', '/var/lib/postgresql/data:rw',
      '--label', 'dev.disposable=1', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=neutral_store',
      '--publish', '127.0.0.1::5432', image);
    containers.push(name);
    const ownerUrl = `postgresql://postgres@${docker('port', name, '5432/tcp')}/neutral_store`;
    const owner = new pg.Pool({ connectionString: ownerUrl }); pools.push(owner);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await owner.query('SELECT 1'); ready = true; break; } catch { await delay(100); }
    }
    if (!ready) throw new Error('demo_postgres_unavailable');
    const version = (await owner.query('SHOW server_version_num')).rows[0].server_version_num;
    if (Number(version) < 160000 || Number(version) >= 170000) throw new Error('demo_postgres_16_required');
    for (const role of ['starter_runtime', 'starter_restore'])
      await owner.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    const selection = { generation: 'qualified-v2', roleMode: 'installer-managed', bootstrapLogin: 'postgres',
      migrationLogin: 'postgres', runtimeLogin: 'starter_runtime', restoreLogin: 'starter_restore' };
    const migration = new pg.Pool({ connectionString: ownerUrl, options: qualifiedPostgresStartupOptions(selection) }); pools.push(migration);
    const runner = createPlatformPostgresMigrationRunner({ connectionString: ownerUrl }, { installation: selection, poolFactory: () => migration });
    await runner.apply();
    if ((await runner.status()).pending.length) throw new Error('demo_installation_incomplete');
    await owner.query(`COMMENT ON DATABASE neutral_store IS '${demonstrationMarker}'`);
    await applyDemoSeed(config, { connection: owner, installRole: 'postgres', runtimeRole: 'starter_runtime', close: async () => {} });
    const directory = resolve(state, config.id); await mkdir(directory, { mode: 0o700 });
    const keyring = resolve(directory, 'quote-key.json');
    await writeFile(keyring, JSON.stringify({ current: randomBytes(32).toString('base64url') }), { mode: 0o600 });
    const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(done => probe.close(done));
    const runtimeUrl = ownerUrl.replace('postgres@', 'starter_runtime@');
    const host = spawn(process.execPath, ['--experimental-strip-types', resolve(root, 'host/server.ts'), '--configuration', config.id,
      '--port', String(port), '--database-url', runtimeUrl, '--quote-acceptance-key-file', keyring], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    hosts.push(host);
    // Host output can carry private fixture information; never forward it to CI artifacts.
    let logs = ''; host.stdout.on('data', b => { logs += b; }); host.stderr.on('data', b => { logs += b; });
    const baseURL = `http://127.0.0.1:${port}`; ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${baseURL}/api/config`)).ok) { ready = true; break; } } catch {}
      if (host.exitCode !== null) break;
      await delay(100);
    }
    await writeFile(resolve(directory, 'host.private.log'), logs, { mode: 0o600 });
    if (!ready) throw new Error('demo_host_unavailable');
    entries.push({ id: config.id, baseURL, runtimeUrl, directory });
  }
  await writeFile(resolve(root, '.context/database-ui-hosts.json'), JSON.stringify(entries.map(({ id, baseURL }) => ({ id, baseURL }))), { mode: 0o600 });
  // Playwright matches project/file plus title; a leading ^ would select zero tests.
  await command('npx', ['--no', '--', 'playwright', 'test', '--config', 'playwright.database.config.ts', 'browser/acquisition.spec.ts',
    '--grep', 'a discounted first-subscription purchase settled through the sandbox$', '--workers', '1', '--retries', '0', '--reporter', 'line']);
  for (const entry of entries) {
    const runtime = new pg.Pool({ connectionString: entry.runtimeUrl }); pools.push(runtime);
    const store = createPostgresOutboxStore(runtime), capture = createPrivateCapture(resolve(entry.directory, 'tally'));
    const first = await runDemoSubscriber(store, capture);
    if (!first.ok || first.processed !== 1) throw new Error('demo_settlement_tally_required');
    const second = await runDemoSubscriber(store, capture);
    if (!second.ok || second.processed !== 0) throw new Error('demo_settlement_replay_failed');
  }
  console.log('PASS: two native sandbox subscription purchases; settlement tally and replay.');
} finally {
  for (const host of hosts) {
    if (host.exitCode === null && host.signalCode === null) {
      const exited = once(host, 'exit'); host.kill('SIGTERM'); await exited;
    }
  }
  for (const pool of pools) await pool.end();
  for (const name of containers) docker('rm', '--force', '--volumes', name);
}
