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

Still uncovered: transitive Maven dependencies, which cannot be resolved without a Gradle build, and
the GitHub Actions runner images.
