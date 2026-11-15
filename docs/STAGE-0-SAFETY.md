# Stage 0: first durable metadata checkpoint

Branch: `dev/flowstate-upgrade-20261115`.
Base: `4dfc4f0cf6721eb5511dedba34a487323e9116ac`.

## What this checkpoint implements

`storage.js` is a dependency-free metadata validation and versioned-envelope
module, usable from the browser or Node. It accepts legacy flat FlowState data,
preserves IDs, class relationships, settings, text, attachment references, and
unknown JSON fields, and wraps validated data without recreating records.

Corrupt JSON, duplicate IDs, invalid structures, prototype-related fields,
unsupported future versions, non-JSON values, accessors, and cycles are rejected
rather than silently repaired. Empty class collections remain empty. Orphan
class references are retained with warnings. Inputs are not mutated.

## Activation and honest limits

This is an additive foundation only. It is NOT referenced by index.html yet;
existing application behavior and stored user data are unchanged. It performs no
storage writes, network calls, native operations, or automatic migration.

The IndexedDB/recovery UI draft previously exercised in Chromium must be restored,
retested, and integrated in a later checkpoint. Do not count historical sandbox
tests as evidence that this commit activates those features. Stage 0 is not complete.

There are no new third-party runtime or test dependencies in this checkpoint.
Run `node --test tests/storage.test.js`. The current suite contains 27 passing
Node tests, including a 10,000-record round trip and a browser-global loader smoke
test. This is not a full browser, WebView, physical-device, or APK installation test.

No Android dependency vulnerability scan has been completed here: new scan
coverage is 0 packages, not a clean result. Actual resolved Android/transitive/build
dependency locking and vulnerability coverage remain required.

## Existing app and release constraints

The existing Android project is under android/. Its main-branch WebView loads
https://cag0123abc-debug.github.io/FlowStateFinal/ and Pages publishes main.
Changing this development branch alone does not change the live interface.
The earlier feature branch uses a different origin; changing origins without
verified migration can make existing localStorage/IndexedDB data inaccessible.

Historical debug APKs use com.flowstate.app.debug, version codes 1 and 2, with
different extracted signing certificates. The newest artifact is only a reference,
not proof of the installed signer. No package, version, signing, Gradle, workflow,
or native-origin changes are included here. Do not substitute signing keys or
claim a no-uninstall update until the installed identity and retained key match.

The old interface contains an exposed legacy sync credential. Its value is not
reproduced here. This additive checkpoint does not yet remove or revoke it.
Revocation/rotation and retirement of the old connector remain required; proper
OAuth/two-way Calendar integration is not implemented by this checkpoint.

## Next bounded change

Integrate transactional IndexedDB metadata and immutable raw-data recovery
snapshots while retaining original storage. Add explicit restore/source review,
visible read-only recovery, conflict detection, and browser/offline/failure tests.
Do not overwrite empty defaults onto corrupt data or call metadata-only exports
complete media backups. Attachment-inclusive archives and Android tests remain
required before claiming end-to-end data preservation.
