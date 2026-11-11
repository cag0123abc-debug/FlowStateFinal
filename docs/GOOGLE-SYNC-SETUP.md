# Two-way Google Calendar sync — setup

FlowState syncs with Google Calendar through a small relay that **you** deploy in
**your own** Google account. That design is deliberate:

- No Google client secret, API key or refresh token ships inside the app or this
  repository. Anything embedded in a public client is not a secret.
- The relay runs with your own authorization, so it can only reach the calendar
  you choose.
- You can revoke access at any time without touching the app.

Without a relay, FlowState still exports `.ics` / Google Calendar links and
imports `.ics` files, with duplicate prevention. Automatic two-way sync requires
the steps below.

---

## 1. Create the relay

1. Open <https://script.google.com> and choose **New project**.
2. Delete the sample code and paste the entire contents of `sync-relay.gs`.
3. Rename the project (for example `FlowState sync`).

## 2. Set the token and target calendar

In the project: **Project Settings → Script properties → Add script property**

| Property | Required | Purpose |
| --- | --- | --- |
| `FLOWSTATE_TOKEN` | **yes** | Long random string. The app must present it on every request. |
| `FLOWSTATE_CALENDAR` | no | Calendar name or id to sync. Defaults to your primary calendar. |
| `FLOWSTATE_TZ` | no | IANA zone such as `Europe/London`. Defaults to the script time zone. |

Generate a token with something like `openssl rand -hex 32` and keep it out of
the repository. Do not reuse a password.

## 3. Deploy as a web app

1. **Deploy → New deployment → Web app**.
2. *Execute as*: **Me**.
3. *Who has access*: **Anyone** (the token is what protects it — Google's
   "Anyone" here means "anyone with the URL", and the URL is unguessable).
4. Authorize the scopes Google asks for (calendar read/write).
5. Copy the `/exec` URL.

Opening the `/exec` URL in a browser returns
`{"ok":true,"service":"flowstate-sync",...}` — that is the liveness probe, not
calendar data.

## 4. Connect FlowState

1. Open FlowState → **Settings** → **Set up sync**.
2. Paste the `/exec` URL and the token.
3. Press **Test**. A successful test shows *"Endpoint answered. Two-way sync is
   ready."*
4. Turn on **Google Calendar sync**.

On Android the URL and token are stored through the native bridge in the
Keystore. In a browser they are stored in this device's `localStorage` only.

---

## What syncs, and how duplicates are avoided

- **Outbound:** creating, editing or deleting an event queues an `upsert` /
  `delete` job. Jobs survive being offline and flush when you reconnect.
- **Inbound:** the app pulls automatically every 5 minutes while it is open and
  online, plus on launch, on tab focus and when the connection returns.
- **Identity:** each Google event carries a `[flowstate:<local-id>]` marker in
  its description. That marker is matched first; otherwise an exact
  title + start-time match links the two. The same event therefore cannot be
  stored twice, whether it arrives by pull, by `.ics` import or by push.
- **Conflicts:** if the local copy has a genuinely newer edit than the remote
  copy, the local edit is kept instead of being silently overwritten.
- **Origin:** imported items keep a `source` field (`google`, `ics`) and the
  calendar name, so you can tell where an event came from.

The merge rules live in `sync-engine.js` and are covered by
`tests/sync.test.js` (run `node tests/sync.test.js`).

## Known limits

- **Skipped occurrences stay local.** Deleting one occurrence of a series is not
  propagated to Google; the series itself still syncs.
- **Series edits, not instance edits.** Editing a recurring event updates the
  whole series in Google, because a single instance cannot be re-timed reliably
  through the Apps Script calendar API.
- **Apps Script quotas** apply (execution time and daily trigger limits on free
  Google accounts). A relay that hits its quota returns an error the app shows
  rather than silently dropping changes.
- **The relay is yours to maintain.** If you redeploy it, use
  *Deploy → Manage deployments → Edit* so the `/exec` URL stays the same.

## Rotating or revoking the token

1. Change `FLOWSTATE_TOKEN` in Script properties.
2. Re-enter the new token in FlowState → Settings.
3. The old token stops working immediately.

To revoke access completely: delete the deployment, and remove the app from
<https://myaccount.google.com/permissions>. FlowState keeps working offline and
falls back to `.ics` import/export.
