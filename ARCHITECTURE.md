# FlowState Architecture (Stage 0 summary)

This file was written during the upgrade work on the dev/flowstate-upgrade branch. It describes the app as it was on main at commit 4dfc4f0.

## How the app runs

- The Android app (com.flowstate.app) is a thin shell. MainActivity.kt opens a full-screen WebView.
- The WebView loads https://cag0123abc-debug.github.io/FlowStateFinal/ (GitHub Pages).
- Almost all features live in the web app (index.html, about 51 KB), so changes to the interface reach the Tab only when the Pages site is updated, not when the APK is rebuilt.
- Links to other websites open outside the app. Only the Pages site and Google script hosts load inside the WebView.
- JavaScript is enabled. Files cannot be read from app storage (allowFileAccess is off). File picking goes through the Android file picker.
- No JavaScript bridge (addJavascriptInterface) is registered, so web pages cannot call native Android code.
- Downloads go through Android's DownloadManager.

## Build settings

- Application ID: com.flowstate.app (debug builds use com.flowstate.app.debug).
- minSdk 23, targetSdk 35, compileSdk 35.
- Kotlin 2.0.21, Android Gradle Plugin 8.7.3, Java 17.
- Version on this branch: versionCode 2, versionName 1.1 (was 1 and 1.0).
- No signingConfigs block in the repo. Installing an update over an existing app requires the same signing key. This has not been verified.

## Files

- android/app/src/main/java/com/flowstate/app/MainActivity.kt: WebView shell.
- android/app/src/main/AndroidManifest.xml: manifest.
- android/app/build.gradle: app module build file.
- index.html, sw.js, manifest.json (at the root): web app, service worker, and web manifest served by Pages.
- .github/workflows/build-android.yml: APK build workflow.
- Root build.gradle, settings.gradle, gradle.properties, and android/ copies of the same files. Only the android/ copies are used by the app module.

## Not yet checked

- Contents of index.html (data storage, existing calendar and recurrence code).
- The workflow file and the manifest contents.
- Whether the service worker caches the Pages app.
- Which branch GitHub Pages publishes.

## Stage 0 status

- Dev branch created: done.
- Version bump: done on this branch.
- Architecture summary: this file.
- Data-storage notes and migration plan: not started.
