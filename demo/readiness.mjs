// Read-only observations for the local demo action bindings and finite settlement worker.
// This does not start HTTP, a scheduler or an outbox worker.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { PLATFORM_EVENT_VOCABULARY } from '@openlup/core/outbox';
import { createSchemaProbe } from '@openlup/core/readiness';
import { createPlatformPostgresMigrationRunner, qualifiedPostgresStartupOptions } from '@openlup/platform/migrations';
import { composeNativeBindings } from '../host/native-composition.ts';
import { createOriginPolicy } from '../host/origin-policy.ts';
import { createSettlementSubscriber, settlementEvent } from '../owned/settlement-subscriber.ts';
import { selectConfiguration } from '../owned/store.config.ts';
import { operations } from '../shared/api.ts';
import { operationLimits } from '../shared/limits.ts';

export async function createVerificationInput() {
  const input = JSON.parse(await readFile(process.env.DEMO_READINESS_INPUT, 'utf8'));
  for (const [key, login] of [['ownerUrl', 'postgres'], ['runtimeUrl', 'starter_runtime']]) {
    const u = new URL(input[key]);
    if (u.protocol !== 'postgresql:' || u.hostname !== '127.0.0.1' || u.username !== login
        || u.password || u.pathname !== '/neutral_store' || u.search || u.hash) throw Error('local_demo_connection_required');
  }
  const ownerIdentity = new URL(input.ownerUrl), runtimeIdentity = new URL(input.runtimeUrl);
  if (ownerIdentity.host !== runtimeIdentity.host) throw Error('same_demo_database_required');
  const config = selectConfiguration(input.configuration);
  const keyring = JSON.parse(await readFile(input.keyringFile, 'utf8'));
  const selection = { generation: 'qualified-v2', roleMode: 'installer-managed', bootstrapLogin: 'postgres',
    migrationLogin: 'postgres', runtimeLogin: 'starter_runtime', restoreLogin: 'starter_restore' };
  const owner = new pg.Pool({ connectionString: input.ownerUrl, options: qualifiedPostgresStartupOptions(selection) });
  let native;
  try {
    const marker = (await owner.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
    if (marker?.marker !== 'openlup-neutral-store-demo-v1') throw Error('demonstration_database_required');
    const status = await createPlatformPostgresMigrationRunner({ connectionString: input.ownerUrl },
      { installation: selection, poolFactory: () => owner }).status();
    const tail = [...status.applied, ...status.pending].at(-1);
    const database = 'demo-' + createHash('sha256').update(input.ownerUrl).digest('hex');
    const requiredSchema = { version: tail, migration: tail, objects: [
      { kind: 'table', name: 'public.commerce_orders' }, { kind: 'table', name: 'public.subscriptions' },
      { kind: 'table', name: 'public.outbox_events' },
      { kind: 'column', name: 'public.catalog_skus.option_values' },
      { kind: 'column', name: 'public.subscription_price_policy_revisions.closed_from_open' },
    ] };
    const observed = await createSchemaProbe(owner, async () => ({ database,
      version: status.pending.length ? status.applied.at(-1) ?? null : tail })).observe(requiredSchema);
    native = await composeNativeBindings(input.runtimeUrl, createOriginPolicy(config, 4319), config, keyring);
    // These are the existing host's explicitly refused operations. application.status is handled by the HTTP host itself.
    const requiredPorts = operations.filter(name => name !== 'application.status' && !operationLimits[name]);
    const manifest = (name, version, extra) => ({ name, version, kind: 'rail', emits: [], handles: [], schedules: [],
      routes: [], requiredPorts: [], env: [], ...extra });
    const loadedPackages = await Promise.all(['core', 'outbox', 'platform'].map(async name => {
      const p = JSON.parse(await readFile(new URL(`../node_modules/@openlup/${name}/package.json`, import.meta.url), 'utf8'));
      return { name: p.name, version: p.version, kind: name === 'core' ? 'kernel' : 'rail' };
    }));
    // Construct the actual handler, but never invoke its capture during diagnosis.
    const handler = createSettlementSubscriber({ writeOnce: async () => { throw Error('readiness_effect_forbidden'); } });
    const version = loadedPackages.find(p => p.name === '@openlup/core').version;
    const ownership = JSON.parse(await readFile(new URL('../ownership.json', import.meta.url), 'utf8'));
    const source = createHash('sha256').update(await readFile(new URL('../package-lock.json', import.meta.url)));
    for (const path of [...ownership.owned, ...ownership.managed].filter(path => /\.(ts|mjs)$/.test(path)).sort())
      source.update(path).update(await readFile(new URL('../' + path, import.meta.url)));
    return { candidate: { artifact: 'sha256:' + source.digest('hex'),
      configuration: config.id + ':' + createHash('sha256').update(JSON.stringify(config)).digest('hex'), environment: 'local-sandbox', database, schema: tail }, inventoryComplete: true, loadedPackages,
      contributions: [
        { manifest: manifest('@openlup/platform', version, { requiredPorts, requiredSchema }), handlers: [], schedules: [], routes: [] },
        { manifest: manifest('@openlup/outbox', version, { handles: [handler.eventType] }),
          handlers: [{ eventType: handler.eventType, timeoutMs: handler.timeoutMs }], schedules: [], routes: [] },
      ], vocabulary: PLATFORM_EVENT_VOCABULARY,
      exemptions: PLATFORM_EVENT_VOCABULARY.filter(event => event.eventType !== settlementEvent).map(event => ({
        pattern: event.eventType, prefix: false, owner: 'morrow-demo', state: 'dormant',
        reason: 'Outside the explicitly invoked finite settlement worker; separate native mail/care entries retain pending work.' })),
      bindings: { ports: Object.fromEntries(requiredPorts.map(name => [`@openlup/platform:${name}`, native.actions[name]])),
        routes: {}, triggers: {}, env: {} },
      schemaProbe: { observe: async requirement => { if (requirement !== requiredSchema) throw Error('unexpected_schema_requirement'); return observed; } },
    };
  } finally { await native?.close(); await owner.end(); }
}
