import pg from 'pg';
import { createPostgresOutboxStore } from '@openlup/outbox/postgres';
import { createPrivateCapture } from '../host/private-capture.ts';
import { demonstrationMarker } from '../installation/install.ts';
import { runDemoSubscriber } from '../owned/settlement-subscriber.ts';

if (!process.env.DATABASE_URL) throw new Error('demo_runtime_connection_required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
  if (rows[0]?.marker !== demonstrationMarker) throw new Error('demo_database_required');
  const result = await runDemoSubscriber(createPostgresOutboxStore(pool), createPrivateCapture('.context/settlement-tally'));
  console.log(JSON.stringify({ ok: result.ok, processed: result.processed, failures: result.failures }));
  if (!result.ok) process.exitCode = 1;
} finally { await pool.end(); }
