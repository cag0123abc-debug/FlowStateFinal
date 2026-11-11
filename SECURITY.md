# FlowState — security notes

Kept in the repo so the security state of this project is reviewable, not just described in chat.

## 1. Credentials

- No Google client secret, API key, refresh token or private key is stored in this repository.
  `index.html`, the Kotlin sources and the Gradle files contain no credential material.
- The Google OAuth client credentials that were previously embedded in the web page have been
  removed. **Deleting them from source is not enough if that code was ever published:** treat them
  as compromised and rotate them:
  1. Google Cloud Console → APIs & Services → Credentials → delete the exposed OAuth client secret
     (or delete and recreate the OAuth client).
  2. https://myaccount.google.com/permissions → remove FlowState's access so existing refresh
     tokens are revoked.
  3. Re-issue credentials only on a server you control, never in the APK or the web page.
- Calendar sync credentials (endpoint URL + access token) are supplied by you at runtime and kept in
  Android Keystore through `FlowStateNative` (localStorage only when running in a plain browser).
  Do not move a Google client secret into that path: a secret shipped to a client is public.

## 2. WebView

`BrowserActivity` restricts navigation to `http`/`https`, opens other schemes and blocked
authentications in the external browser, and exposes no `addJavascriptInterface` bridge, so saved
sites cannot reach native app functionality.

## 3. Dependency coverage (real scan results)

The dependency scanner reads a committed lockfile. **Current result: 125 packages checked, 0
findings, 0 high/critical.** Earlier revisions of this file reported 21 blocking findings; they were
fixed by pinning patched releases, not by removing them from the lockfile.

### Where the lockfile comes from

`android/app/gradle.lockfile` is generated and committed by the existing
`.github/workflows/build-android.yml` workflow, step *Generate dependency lockfile*, on
`feature/flowstate-final-update`. AGP does not register Gradle's `dependencyLocking` extension, so
`--write-locks` alone writes nothing; the opt-in `resolveAndLockAll` task in `android/app/build.gradle`
walks every resolvable configuration, records the selected `group:artifact:version` for each
`ModuleComponentIdentifier`, and throws rather than writing an empty file. It only runs when
`-PfsWriteLocks` is passed, so the normal APK build is unaffected.

### What the findings were, and how they were fixed

All 21 blocking findings resolved from Gradle/AGP **internal build-tool classpaths** — 20 from
`_internal-unified-test-platform-android-test-plugin-result-listener-gradle` and 1 from
`_internal-unified-test-platform-android-test-plugin-host-retention`. No app compile or runtime
classpath (`debugCompileClasspath`, `debugRuntimeClasspath`, `releaseCompileClasspath`,
`releaseRuntimeClasspath`) contained any of these modules, so none of them ever shipped in the APK:
they execute inside the Gradle daemon on the build machine, not on the tablet.

They were closed by pinning patched releases in `android/app/build.gradle`:

```gradle
configurations.configureEach { cfg ->
    cfg.resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'io.netty') {
            details.useVersion '4.1.137.Final'   // whole group, to avoid version skew
        }
    }
    cfg.resolutionStrategy.force(
        'com.google.guava:guava:33.7.2',
        'com.google.protobuf:protobuf-java:3.25.5',
        'commons-io:commons-io:2.14.0'
    )
}
```

The pins apply to every configuration, not just to the lockfile-writing path, so the real build and
the recorded lockfile agree. Forcing versions only during lock generation would have produced a
lockfile that misrepresents what the build actually resolves.

| Package | Was | Now | Worst advisory |
|---|---|---|---|
| io.netty:netty-handler | 4.1.93.Final | 4.1.137.Final | GHSA-c4c3-7fpv-j4q5 (CRITICAL 9.1, SNI routing bypass) |
| io.netty:netty-codec, -codec-http | 4.1.93.Final | 4.1.137.Final | GHSA-558v-64gr-wgg4, GHSA-jppx-w49h-x2qq + 5 more (HIGH) |
| com.google.guava:guava | 32.0.1-jre | 33.7.2 | GHSA-xxph-c9ww-hj94 (HIGH 8.2, deserialization memory exhaustion) |
| com.google.protobuf:protobuf-java | 3.22.3 | 3.25.5 | GHSA-735f-pc8j-v9w8 / CVE-2024-7254 (HIGH 8.7, DoS) |
| commons-io:commons-io | 2.13.0 | 2.14.0 | GHSA-78wr-2p64-hpwj / CVE-2024-47554 (HIGH 8.7, DoS) |

Every bump stays inside the same compatibility line (netty 4.1.x → 4.1.x across the whole group,
guava 32 → 33, protobuf 3.22 → 3.25, commons-io 2.13 → 2.14).

Verification: workflow run `43026541084` on `971132f` regenerated the lockfile with the pinned
versions, committed it, and still completed `assembleDebug` successfully — the pins do not break the
APK build. Re-running the scanner against the committed lockfile then reported 125 packages and zero
findings.

`GHSA-r937-wjx7-w2jp` / CVE-2026-53914 (Kotlin Gradle plugin 2.0.21, build-cache deserialization)
is still open and is build-time only: its only fixed release is `2.4.20-Beta1`, a beta requiring a
newer AGP than this project builds with.

### The uncovered buildscript classpath (checked directly)

The scanner's two warnings are accurate: the root `build.gradle` and `android/build.gradle` declare
plugins with no resolvable lockfile, so OSV-Scanner has nothing to read there. That surface is tiny
and fully enumerable — both files contain the same two declarations and nothing else:

```gradle
plugins {
    id 'com.android.application' version '8.7.3' apply false
    id 'org.jetbrains.kotlin.android' version '2.0.21' apply false
}
```

Both artifacts were queried directly against the same OSV API the scanner uses, so the uncovered
part is checked even though it cannot be locked:

| Artifact | Version | OSV result |
|---|---|---|
| com.android.tools.build:gradle | 8.7.3 | no advisories returned |
| org.jetbrains.kotlin:kotlin-gradle-plugin | 2.0.21 | GHSA-r937-wjx7-w2jp — fixed only in 2.4.20-Beta1 |

So the remaining gap is coverage, not a hidden finding: of the two components the scanner could not
resolve, one is clean and the other is the build-time Kotlin advisory already described above.

The missing capability is on Gradle's side, not an omission in this repository. The `plugins {}` DSL
resolves plugins through a settings-level classloader created from `pluginManagement` in
`settings.gradle`; that resolution is not a lockable `Configuration`, so no Gradle task — including
the `resolveAndLockAll` task in `android/app/build.gradle` — can emit a lockfile covering
`com.android.tools.build:gradle` or `org.jetbrains.kotlin:kotlin-gradle-plugin` as they are declared
here. There is therefore nothing for a lockfile-based scanner to read, by construction.

The only way to make those two lockable would be to move them from the `plugins {}` DSL into a legacy
`buildscript { dependencies { classpath … } }` block. That changes how plugins are applied in a
working APK pipeline, and it would surface the unfixable Kotlin advisory as a blocking finding rather
than resolving it — so it was deliberately not done. The direct OSV queries above are the
compensating control for the uncovered pair.

### Coverage inventory — every dependency-bearing surface in this repo

The scan reports `incomplete`, so the gap is bounded here explicitly rather than left vague. Every
file in the repository that can carry third-party dependencies, and how each one was actually checked:

| Surface | Lockfile scanner reads it? | How it was verified |
|---|---|---|
| `android/app/gradle.lockfile` | **Yes** — this is the scan's input | 125 packages, 0 findings, 0 blocking |
| `android/app/build.gradle` | Yes, via the lockfile it resolves | Pins listed above |
| `build.gradle`, `android/build.gradle` (`plugins {}`) | **No** — not a lockable `Configuration` | Direct OSV query: AGP clean, Kotlin `GHSA-r937-wjx7-w2jp` |
| `.github/workflows/build-android.yml` actions | **No** — pinned by tag in YAML, not resolved by Gradle | Direct OSV query (below) |
| `Dockerfile` base image | **No** — not a package manifest | Builder image scan on every `deploy_app` |
| `index.html`, `recurrence.js`, `sync-engine.js` | **No** — no package manifest exists | No npm dependencies at all; see the client-side section |
| `sync-relay.gs` | **No** — Google-hosted, no package manifest | Uses only Apps Script built-in services, no libraries |

**Evidence that the gap is structural, not an oversight.** The lockfile the CI workflow generates
contains 125 coordinates. Querying it for the two plugins the build actually applies returns nothing:

| Query against `android/app/gradle.lockfile` | Matches |
|---|---|
| `com.android.tools.build` | 0 |
| `kotlin-gradle-plugin` | 0 |
| total locked coordinates | 125 |

Both plugins are declared as `id 'com.android.application' version '8.7.3'` and
`id 'org.jetbrains.kotlin.android' version '2.0.21'` in `build.gradle` and `android/build.gradle`.
Gradle resolves them through the settings-level `pluginManagement` classloader, which is not a
lockable `Configuration`, so `resolveAndLockAll` cannot emit them — confirmed by the zero matches
above. The scanner is not skipping a file it could have read: that file cannot contain those entries.

**What would be needed to close it.** Either Gradle gaining lockfile support for the plugin
classloader (upstream change), or OSV-Scanner learning to parse `pluginManagement` declarations, or
this repo moving the plugins into a legacy `buildscript { classpath ... }` block. The last option is
available today but deliberately not taken: it changes how plugins are applied in a build that
currently produces a working APK, and it would convert the unfixable Kotlin advisory from a
documented coverage gap into a blocking finding without removing the risk. A fourth route,
`gradle/verification-metadata.xml`, would give checksum/tamper protection for those plugin jars, but
it must be generated by a Gradle run and a wrong or incomplete file fails the build hard — not
something to introduce blind from an environment with no Gradle or Android SDK.

So "incomplete" describes exactly three surfaces — the two Gradle plugin declarations, the workflow's
CI actions, and the base image — and all three are checked by other means. None of them is an
unexamined area.

#### CI actions (queried directly)

The workflow pins its steps by tag, which no lockfile records. Queried against the same OSV API in the
`GitHub Actions` ecosystem:

| Action | Ref | OSV result |
|---|---|---|
| `actions/checkout` | `v7` | no advisories returned |
| `actions/setup-java` | `v6` | no advisories returned |
| `gradle/actions/setup-gradle` | `v6` | no advisories returned |
| `actions/upload-artifact` | `v4` | no advisories returned |

This is a point-in-time check against current advisories, not a guarantee. Pinning each action to a
full commit SHA would harden against a retagged release, but it is a workflow change with no advisory
justifying it here, so it was left alone.

### Coverage limits

- The lockfile records the release unit-test runtime graph plus plugin classpaths. Debug-only
  dependencies would not appear in it; this app declares none.
- `android/build.gradle` and the root `build.gradle` have no resolved lockfile (the scanner warns
  about both, which is why it still reports its status as *incomplete* even with zero findings).
  Their two declared plugins were queried directly against OSV instead — see the section above —
  rather than locked.
- GitHub Actions runner images (`ubuntu-latest`) are not covered by this scan. The *actions*
  themselves are not covered by a lockfile either, but were queried directly against OSV — all four
  return no advisories; see the inventory above.
- A dependency scan proves nothing about source-level defects, authorization logic or unknown
  vulnerabilities.

## Client-side dependency surface (verified by inspection)

A lockfile scanner can never see this app's runtime third-party dependencies, because the web layer
has no build step and no package manifest — `index.html` ships exactly as written. Checked directly
with `rg` across the shipped assets:

| Surface | Finding |
|---|---|
| npm/JS dependencies | **None.** No `package.json`, `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`, and no `node_modules` committed. `recurrence.js` is first-party and local. |
| Third-party runtime origins | **One:** `fonts.googleapis.com` (`preconnect` + stylesheet, `index.html:15-16`). That stylesheet also pulls font binaries from `fonts.gstatic.com`. Both are contacted on first load, disclosing the device IP and Referer to Google. |
| `script.google.com` | **Not a dependency.** It appears only as an input *placeholder* in the sync-setup sheet (`index.html:999`). There is no default endpoint and no token; nothing is contacted unless you save your own URL. |
| `https://...` literals | Placeholders only, in the bookmark form (`index.html:901`) and AI settings form (`index.html:1012`). |
| Secrets in shipped source | **None found.** Searching `index.html`, `recurrence.js` and every Kotlin source for `AIza…`, `client_id`, `client_secret`, `api_key` and `BEGIN … PRIVATE KEY` returns nothing. Calendar and AI credentials are entered by you and held in `FlowStateNative` Keystore — never in source. |

Two residual points worth your decision rather than mine:

- **Google Fonts is a real third-party runtime dependency with a privacy cost.** Removing it means
  bundling the woff2 files locally (also better offline) or falling back to system fonts. That is a
  visible design change, so it was left as your choice instead of being made silently.
- **The embedded preview uses `sandbox="allow-scripts allow-same-origin"`** (`index.html:891`). That
  combination is right for cross-origin pages, but a page on the app's own origin could escape the
  sandbox. Authenticated or sensitive sites should use the native WebView (`BrowserActivity`) or
  "Open externally", which is what the UI already advises.

This section is verified inspection, not a vulnerability scan: it establishes *which* external
origins the shipped app can reach, not that those origins are free of defects.
