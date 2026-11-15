import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OutboxEventRow, OutboxStore } from '@openlup/outbox';
import { createSettlementSubscriber, runDemoSubscriber, settlementEvent } from '../owned/settlement-subscriber.ts';
import { createPrivateCapture } from '../host/private-capture.ts';

const row = (): OutboxEventRow => ({ id: randomUUID(), event_type: settlementEvent,
  aggregate_type: 'order', aggregate_id: randomUUID(), idempotency_key: randomUUID(),
  created_at: new Date().toISOString(), available_at: new Date().toISOString(), processed_at: null,
  status: 'pending', attempts: 0, payload: { email: 'synthetic@example.test' }, error: null, metadata: {} });

test('subscriber captures once across a new instance after lost acknowledgement; no payload retained', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'morrow-tally-'));
  try {
    const event = row(), signal = new AbortController().signal;
    await createSettlementSubscriber(createPrivateCapture(directory)).handle(event, signal);
    await createSettlementSubscriber(createPrivateCapture(directory)).handle(event, signal);
    assert.equal((await readdir(directory)).length, 1);
    assert.deepEqual(await createPrivateCapture(directory).read(`morrow:settlement:v1:${event.id}`),
      { eventId: event.id, kind: 'sandbox-settlement', version: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('wrong event and aborted invocation refuse before effects', async () => {
  let writes = 0;
  const handler = createSettlementSubscriber({ read: async () => null, writeOnce: async () => { writes++; } });
  assert.deepEqual(await handler.handle({ ...row(), event_type: 'commerce.order.paid.email' }, new AbortController().signal),
    { kind: 'retry', reason: 'demo_subscriber_event_invalid' });
  assert.deepEqual(await handler.handle(row(), AbortSignal.abort()), { kind: 'retry', reason: 'demo_subscriber_aborted' });
  assert.equal(writes, 0);
});

test('worker binds only the settlement subscriber; capture failure leaves work retryable', async () => {
  const event = row(); let claims = 0, retried = 0, acknowledged = 0;
  const store: OutboxStore = {
    async claimBatch(input) {
      assert.deepEqual(input.eventTypes, [settlementEvent]);
      return claims++ === 0 ? [{ ...event, metadata: { claimToken: 'fixture-claim' } }] : [];
    },
    async markProcessed() { acknowledged++; return { applied: true }; },
    async markFailed(input) { assert.equal(input.outcome, 'retry'); retried++; return { status: 'failed' }; },
    async releaseUnprocessed() { return 0; },
  };
  await runDemoSubscriber(store, { read: async () => null, writeOnce: async () => { throw new Error('offline disk failure'); } });
  assert.equal(retried, 1); assert.equal(acknowledged, 0);
});
