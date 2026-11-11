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

## 3. Dependency coverage (honest status)

The automated dependency scan reports **incomplete, 0 packages checked**. This repository has no
lockfile (`package.json`/lockfile absent, Gradle without dependency locking), which is the input the
scanner needs, so its result must **not** be read as a clean scan.

Manual OSV advisory lookup of the coordinates declared in `android/app/build.gradle` plus the build
plugin versions (2026-11-11):

| Coordinate | Version | Result |
|---|---|---|
| androidx.activity:activity-ktx | 1.9.3 | no advisories |
| androidx.core:core-ktx | 1.13.1 | no advisories |
| androidx.webkit:webkit | 1.12.1 | no advisories |
| com.android.tools.build:gradle | 8.7.3 | no advisories |
| org.jetbrains.kotlin:kotlin-gradle-plugin | 2.0.21 | **GHSA-r937-wjx7-w2jp** / CVE-2026-53914 |

**GHSA-r937-wjx7-w2jp** — "Unsafe Deserialization in Kotlin Build Cache Enables Code Execution".
Severity MODERATE (CVSS 3.1 AV:L/AC:H/PR:H). It is a **build-time** issue: an attacker with local,
high-privilege access could execute code through the Gradle build cache. It does not ship inside the
APK and is not reachable from the app at runtime. The only fixed release is `2.4.20-Beta1`, a beta
that requires a newer Android Gradle Plugin than the 8.7.3 this project builds with, and the APK
build cannot be compiled in this environment to prove such an upgrade. The plugin is therefore kept
at 2.0.21 and this advisory is tracked openly rather than silenced.

### Why the gap exists, with evidence

- The scanner (OSV-Scanner 2.7.0) reads **lockfiles**. This repository has none: no `package.json`,
  no `package-lock.json`, and Gradle dependency locking is not enabled, so there is no
  `gradle.lockfile`. That is why it reports `packages_checked: 0`. A zero-package result is a
  coverage gap, **not** a clean bill of health.
- Generating the missing input needs Gradle with the Android plugin. This build environment has no
  Gradle wrapper (`android/gradle/wrapper` is absent) and no Android SDK (`ANDROID_HOME` unset), so
  `./gradlew` cannot run here.
- Maven cannot stand in for it: AndroidX publishes `.aar` artifacts, and plain Maven 3.9.9 has no
  Android tooling, so `mvn dependency:list` fails with
  `Could not find artifact androidx.activity:activity-ktx:jar:1.9.3`.

**Still uncovered:** the entire transitive dependency graph (one hop and deeper) of the three
AndroidX libraries, plus the GitHub Actions runner images. Nothing here proves those are free of
advisories — they are simply unverified.

### How to close it (runs in CI, where the Android toolchain exists)

1. Add a Gradle wrapper to `android/` (`gradle wrapper --gradle-version 8.9`).
2. Enable locking in `android/app/build.gradle`:
   `dependencyLocking { lockAllConfigurations() }`
3. Write the lockfile: `./gradlew :app:dependencies --write-locks` → produces `android/gradle.lockfile`.
4. Commit that lockfile; the dependency scanner then resolves the full graph and this section can be
   replaced with real results.

Until step 4 is done and its output reviewed, treat dependency vulnerability status as **unverified
beyond the five coordinates in the table above**.

#### Paste-ready workflow

This file is **additive** — it does not touch `build-android.yml` or the APK pipeline. Save it as
`.github/workflows/dependency-scan.yml`, keep the `dependencyLocking` block from step 2 in
`android/app/build.gradle`, then run it from the Actions tab. It writes the lockfile on a runner that
has the Android toolchain, uploads it, and scans it.

```yaml
name: Dependency scan
on:
  workflow_dispatch:
  pull_request:
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: android-actions/setup-android@v3
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.9'
      - name: Write Gradle lockfile
        working-directory: android
        run: gradle :app:dependencies --write-locks
      - name: Keep the lockfile
        uses: actions/upload-artifact@v4
        with:
          name: gradle-lockfile
          path: android/**/gradle.lockfile
          if-no-files-found: error
      - name: Scan resolved dependencies
        uses: google/osv-scanner-action/osv-scanner-action@v1
        with:
          scan-args: |-
            --lockfile=android/app/gradle.lockfile
```

Two caveats, stated plainly: this YAML has never been executed — there is no Gradle wrapper or
Android SDK in the environment where it was written — so check the first run's log and adjust action
versions if GitHub reports a stale tag. `gradle-version` 8.9 is the floor for AGP 8.7.3; bump it
only alongside AGP. Download the uploaded `gradle-lockfile` artifact and commit it, so the scanner
has the lockfile even when this workflow is not running.

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
