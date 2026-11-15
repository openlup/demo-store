# Morrow settlement tally

This is an OpenLup first-party demo store extension, using sandbox data only.
The public guide's **Choose an extension seam → Wire and verify the extension**
selects `OutboxHandler` from `@openlup/outbox`, bound in a worker registry.
See `node_modules/@openlup/core/docs/guide/how-to/extend/choose-an-extension-seam.md#wire-and-verify-the-extension`
and `how-to/build/outbox.md#select-and-compose-handlers` in that installed guide.

`owned/settlement-subscriber.ts` binds only `commerce.settlement.settled`.
It captures one event-ID-only tally artifact under private, ignored
`.context/settlement-tally/`. The native producer still owns payment and order
truth. No email, money, customer facts or event payload is copied or sent.
The subscriber never changes subscription cadence or delivery alignment.

Explicit invocation against the marked demo installation's runtime connection:

```sh
DATABASE_URL='<local demo runtime connection>' node --experimental-strip-types owned/settlements.ts
```

Importing the module installs no route, schedule or worker. Keep this invocation
separate from the starter's paid-mail and recovery dispatch. It acknowledges
settlement facts after capture; it cannot also represent another consumer of
that same effect. The private capture's exclusive durable write and identical
readback preserve the tally across replay and process restart. Keep the capture
files with their demo database when restarting; do not run concurrent workers
with separate capture directories. Capture failure leaves the event retryable.

`test/demo-settlement.test.ts` checks restart/replay, privacy of the captured
record, wrong-event/abort refusal, and the real worker's allowlist/failure path.
The demo purchase harness also invokes this worker after native sandbox payment.
