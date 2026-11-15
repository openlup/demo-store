import { uniqueRegistry, runOutboxDispatchWorker, readOutboxDispatchConfig } from '@openlup/outbox';
import type { OutboxHandler, OutboxStore } from '@openlup/outbox';
import { PLATFORM_EVENT_VOCABULARY } from '@openlup/core/outbox';
import type { PrivateCapture } from '../host/private-capture.ts';

export const settlementEvent = 'commerce.settlement.settled';

/** Application-only sandbox tally. No customer, payment payload or money is copied. */
export function createSettlementSubscriber(capture: PrivateCapture): OutboxHandler {
  return {
    eventType: settlementEvent,
    timeoutMs: 5000,
    async handle(row, signal) {
      if (signal.aborted) return { kind: 'retry', reason: 'demo_subscriber_aborted' };
      if (row.event_type !== settlementEvent || !/^[a-f0-9-]{36}$/i.test(row.id)) {
        return { kind: 'retry', reason: 'demo_subscriber_event_invalid' };
      }
      const key = `morrow:settlement:v1:${row.id}`;
      // Durable exclusive write + identical readback survive an acknowledgement loss.
      await capture.writeOnce(key, { version: 1, eventId: row.id, kind: 'sandbox-settlement' });
      return { kind: 'processed', detail: { demoTally: true } };
    },
  };
}

/** Explicit finite invocation; importing this module starts no worker. */
export function runDemoSubscriber(store: OutboxStore, capture: PrivateCapture) {
  return runOutboxDispatchWorker({
    store,
    registry: uniqueRegistry([createSettlementSubscriber(capture)]),
    config: readOutboxDispatchConfig({}),
    knownEventTypes: PLATFORM_EVENT_VOCABULARY.map(event => event.eventType),
  });
}
