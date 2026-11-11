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

### Coverage limits

- The lockfile records the release unit-test runtime graph plus plugin classpaths. Debug-only
  dependencies would not appear in it; this app declares none.
- `android/build.gradle` and the root `build.gradle` have no resolved lockfile (the scanner warns
  about both, which is why it still reports its status as *incomplete* even with zero findings).
  Locking those buildscript classpaths would add the AGP/Kotlin plugin graph — including the
  beta-only-fix Kotlin advisory above — rather than reduce risk, so they stay unlocked and are
  documented here instead.
- GitHub Actions runner images are not covered by this scan.
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
