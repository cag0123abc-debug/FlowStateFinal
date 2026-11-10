FLOWSTATE ANDROID APK PROJECT

This project wraps the existing hosted FlowState website in a native Android
WebView application. It does not replace or edit index.html.

UPLOAD:
1. In your GitHub repository, create the folder structure shown in this ZIP.
2. Put the workflow file at .github/workflows/build-android.yml (not inside android).
3. Put the Android project files inside the android folder.
4. Commit the new files to the default branch.
5. Open the repository's Actions tab.
6. Select "Build FlowState Android APK" and run it, or wait for the push build.
7. Open the completed run and download the "FlowState-debug-APK" artifact ZIP.
8. Extract app-debug.apk on Android and install it. Android may ask you to allow
   installs from the app used to open the APK.

IMPORTANT:
- The APK loads https://cag0123abc-debug.github.io/FlowStateFinal/; the website
  remains hosted online and continues to provide the app UI and Apps Script logic.
- WebView storage is separate from Firefox/Clint Gecko browser storage. Existing
  browser-only tasks/settings will not automatically migrate.
- This is a debug-signed APK suitable for personal testing, not a Play Store
  release package.
- The app opens external web links and Google sign-in pages in the Android browser.
- Never put Google Apps Script secrets or private tokens in Android source code.
