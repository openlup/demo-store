# Morrow: OpenLup first-party demo store

**Released 0.43.0 seed**, extracted from `openlup-core-v0.43.0` at
`6facc3e72441ade5813397f65ac7edbe34fd1d0f`. The first commit retains the
pristine extraction; later commits replay application customization, extension
and CI. This seed alone is not adjacent-pair upgrade evidence.
Morrow is fictional, using XTS test units in fictional market ZZ, synthetic
contacts and sandbox providers. It takes no real payments and sends no mail.
The three fictional coffee roasts are the default shelf; the second starter
configuration remains available for shared-contract checks.

## Run the same checks as CI

Use Node 24.21.0 and Docker. Authenticate Docker to GHCR using a local credential
with `read:packages` and access to `openlup/library/postgres`. Never commit it.
On macOS, put the pinned OpenLup Node toolchain on PATH. Then run:

```sh
node demo/verify.mjs
```

The runner checks the 15-minute load is below 12 before installs and tests
(`sysctl -n vm.loadavg` on macOS). It runs `npm ci`, typecheck, build and all
application tests; pulls only the digest in `demo/images.json`; installs the
matching Playwright Chromium; and runs the starter's persisted sandbox
subscription purchase for both configurations with zero retries. A finite
[settlement subscriber](EXTENSION.md) invocation and empty replay follow payment.
No anonymous or upstream image fallback exists. Each test database is in its own
loopback-only PostgreSQL 16 container with temporary storage, complete installed
package migrations and a restricted runtime role. The harness removes its own
containers and closes its hosts/pools on success or failure. A killed process
may require removal of its labelled `morrow-demo-*` containers.

`.context/ci-receipt.json` records the selected set, exact lock SHA-256,
unchanged extraction identity, image digest, result and duration per check.
A changed set may have a new lock; the original extraction identity remains
historical. Missing GHCR access fails verification and blocks the purchase;
it never counts as a passing journey. Private logs, keys and browser fixtures
stay in ignored `.context/`; no tracing, screenshots or video is collected.
CI uploads only the JSON receipt for 90 days. `demo/local-receipt.json` records
local verification separately from CI. A local rehearsal using a PATH shim for
the exact already-cached PostgreSQL image is labelled "local rehearsal, shimmed
pull, not CI evidence"; it proves neither GHCR access nor a hosted CI pass.
Build warnings from the starter's browser-externalized Node modules remain in
private logs; a build pass alone is not evidence of a persisted purchase.

## Released seed and later upgrade

`demo/preparation-inputs.json` retains the release tag, revision, manifest,
extractor identity and toolchain. The tag commit was independently resolved;
the archive extractor correctly records its source revision as `supplied`.
The exact public-registry lock and unchanged `.starter-origin.json` remain in Git.
All package integrities were checked against npm and the release cut manifest.
Customization remains in owned paths; extension and CI paths are added to the
owned inventory while the released managed inventory is preserved.

For the later 0.43→0.44 upgrade, retain immutable pristine extractions, locks and
origin identities for both releases. Derive managed-file snapshots from those
pristine inputs, use the installed public upgrade plan/apply commands, move all
package dependencies together, and retain a fresh passing verification receipt.
No adjacent-pair upgrade has run as part of this seed.

## Owner settings for the existing empty public repository

After authorized released seeding, enable Actions in `openlup/demo-store` and
allow the pinned checkout, setup-node and upload-artifact actions. Set Actions
artifact retention to permit 90 days. In the org package
`openlup/library/postgres`, open **Package settings → Manage Actions access →
Add repository → openlup/demo-store**, with **Read** access. Keep authenticated
pulls; public visibility alone is not this workflow's authorization mechanism.
If org policy restricts packages, allow `GITHUB_TOKEN` package reads. The job
requests `contents: read` and `packages: read`, with no write permission.
After the first successful run creates the check, protect `main` (ruleset or
branch protection): require PRs, the **Demo store verification** status check,
resolved conversations and one approving review; block force pushes and deletion.
Keep secrets empty. H0 runs only in Actions; no hosting, DNS or deployment is
required. No remote, push, PR or GitHub settings change was made locally.
