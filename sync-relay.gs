/**
 * FlowState <-> Google Calendar sync relay (Google Apps Script)
 * ---------------------------------------------------------------
 * This is the server half of FlowState's two-way calendar sync. It runs inside
 * YOUR OWN Google account, under YOUR authorization. The FlowState app never
 * contains a Google client secret, refresh token or API key: it only knows the
 * deployment URL and the private token you choose.
 *
 * SETUP (full walkthrough in docs/GOOGLE-SYNC-SETUP.md):
 *   1. script.google.com -> New project -> paste this file.
 *   2. Project Settings -> Script properties:
 *        FLOWSTATE_TOKEN     = a long random string (required)
 *        FLOWSTATE_CALENDAR  = calendar name or id (optional, default calendar)
 *        FLOWSTATE_TZ        = e.g. Europe/London (optional, script time zone)
 *   3. Deploy -> New deployment -> Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Paste the /exec URL and the same token into FlowState -> Settings.
 *
 * SECURITY NOTES
 *   - The token lives only in Script properties, never in this file or the repo.
 *   - Every request must present it; comparison is constant-time to avoid
 *     leaking length or prefix information through timing.
 *   - The relay only ever touches the calendar you point it at, and only
 *     through your own account's permissions. There is no shared server.
 *   - Rotate the token by editing FLOWSTATE_TOKEN and re-entering it in
 *     FlowState; revoke access entirely from your Google Account's
 *     "Third-party apps" page and by deleting the deployment.
 *
 * REQUEST / RESPONSE CONTRACT (must stay in step with index.html syncPost):
 *   POST body: {token, action, ...}
 *     action 'test'   -> {ok, service, calendar, time}
 *     action 'pull'   -> {ok, items:[...]}         (since: epoch ms, optional)
 *     action 'push'   -> {ok, items:[...]}         (items: [...])
 *     action 'upsert' -> {ok, item:{...}}          (item: {...})
 *     action 'delete' -> {ok, deleted:n}           (id: local item id)
 *   Item shape: {uid, title, due, body, calendar, type, repeat, updated}
 *     - uid is the Google event id, so pulls are idempotent.
 *     - repeat is a bare RRULE string (no "RRULE:" prefix) so the app can hand
 *       it straight to FSRec.fromRRule.
 */

var PROPS = PropertiesService.getScriptProperties();
var DAY_MS = 24 * 60 * 60 * 1000;
var DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/* ---------------------------------------------------------------- entry points */

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'bad_json' });
  }
  if (!authorised(body.token)) return json({ ok: false, error: 'unauthorized' });

  var action = String(body.action || '');
  try {
    if (action === 'test') {
      return json({ ok: true, service: 'flowstate-sync', calendar: calendar_(body).getName(), time: new Date().toISOString() });
    }
    if (action === 'pull') return json(pull_(body));
    if (action === 'push') return json(push_(body));
    if (action === 'upsert') return json({ ok: true, item: upsert_(body.item, body) });
    if (action === 'delete') return json({ ok: true, deleted: remove_(body.id, body) });
    return json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    /* Return the reason so the app can show it, without leaking internals. */
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  /* No calendar data here: just a liveness probe for the deploy step. */
  return json({ ok: true, service: 'flowstate-sync', hint: 'POST with a valid token' });
}

/* ------------------------------------------------------------------- auth */

function authorised(token) {
  var expected = PROPS.getProperty('FLOWSTATE_TOKEN') || '';
  if (!expected || !token) return false;
  var a = String(token);
  var b = String(expected);
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    diff |= a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ----------------------------------------------------------------- calendar */

function calendar_(body) {
  var wanted = PROPS.getProperty('FLOWSTATE_CALENDAR') || (body && body.calendar) || '';
  if (wanted) {
    try {
      var byId = CalendarApp.getCalendarById(wanted);
      if (byId) return byId;
    } catch (err) { /* not an id, try by name */ }
    var named = CalendarApp.getCalendarsByName(wanted);
    if (named && named.length) return named[0];
  }
  return CalendarApp.getDefaultCalendar();
}

/* ------------------------------------------------------------ pull (Google -> app) */

function pull_(body) {
  var cal = calendar_(body);
  var now = Date.now();
  var since = Number(body.since || 0);
  var events = cal.getEvents(new Date(now - 365 * DAY_MS), new Date(now + 365 * DAY_MS));
  var items = [];
  for (var i = 0; i < events.length; i++) {
    var it = toItem_(events[i], cal);
    if (!it) continue;
    /* `since` is an optimisation only: a full pull is always safe because the
       app matches on uid, so nothing is duplicated if this filter is ignored. */
    if (since && it.updated && it.updated < since) continue;
    items.push(it);
  }
  return { ok: true, items: items, calendar: cal.getName() };
}

function toItem_(ev, cal) {
  var start = ev.getStartTime();
  if (!start) return null;
  var rec = ev.getRecurrence() || [];
  var rrule = '';
  for (var i = 0; i < rec.length; i++) {
    if (/^RRULE/i.test(rec[i])) { rrule = String(rec[i]).replace(/^RRULE:/i, ''); break; }
  }
  var updated = ev.getLastUpdated ? ev.getLastUpdated() : null;
  return {
    uid: ev.getId(),
    title: ev.getTitle(),
    due: fmt_(start),
    body: stripMarker_(ev.getDescription() || ''),
    calendar: cal.getName(),
    type: 'event',
    repeat: rrule || null,
    updated: updated ? updated.getTime() : 0,
    source: 'google'
  };
}

/* ------------------------------------------------------------ push (app -> Google) */

function push_(body) {
  var list = body.items || body.events || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || !String(item.title || '').trim()) continue;
    out.push(upsert_(item, body));
  }
  return { ok: true, items: out, pushed: out.length };
}

function upsert_(item, body) {
  if (!item || !String(item.title || '').trim()) throw new Error('item.title required');
  var cal = calendar_(body);
  var start = parse_(item.due || item.start);
  var end = new Date(start.getTime() + 60 * 60 * 1000);
  var desc = withMarker_(item.body || '', item.id || item.uid || '');
  var rec = recurrence_(item);
  var existing = find_(cal, item, start);

  if (existing) {
    existing.setTitle(item.title);
    try { existing.setTime(start, end); } catch (err) {
      /* A recurring series cannot always be re-timed in place; fall back to a
         fresh event rather than losing the edit. */
      var fresh = cal.createEvent(item.title, start, end, { description: desc, recurrence: rec.length ? rec : undefined });
      return toItem_(fresh, cal);
    }
    existing.setDescription(desc);
    if (rec.length) existing.setRecurrence(rec);
    return toItem_(existing, cal);
  }

  var created = cal.createEvent(item.title, start, end, {
    description: desc,
    recurrence: rec.length ? rec : undefined
  });
  return toItem_(created, cal);
}

/* Find the Google counterpart of a local item: stable marker first, then an
   exact title + start match, which is what prevents duplicate events when the
   same item is pushed twice before it has a uid. */
function find_(cal, item, start) {
  var from = new Date(start.getTime() - DAY_MS);
  var to = new Date(start.getTime() + DAY_MS);
  var events = cal.getEvents(from, to);
  var marker = marker_(item.id || item.uid || '');
  var i;
  if (marker) {
    for (i = 0; i < events.length; i++) {
      if (String(events[i].getDescription() || '').indexOf(marker) >= 0) return events[i];
    }
  }
  var key = normTitle_(item.title);
  var due = fmt_(start);
  for (i = 0; i < events.length; i++) {
    if (normTitle_(events[i].getTitle()) !== key) continue;
    if (fmt_(events[i].getStartTime()) === due) return events[i];
  }
  return null;
}

function remove_(id, body) {
  var cal = calendar_(body);
  var marker = marker_(id || '');
  if (!marker) return 0;
  var now = Date.now();
  var events = cal.getEvents(new Date(now - 365 * DAY_MS), new Date(now + 365 * DAY_MS));
  var removed = 0;
  for (var i = 0; i < events.length; i++) {
    if (String(events[i].getDescription() || '').indexOf(marker) >= 0) {
      events[i].deleteEvent();
      removed++;
    }
  }
  return removed;
}

/* ------------------------------------------------------------- recurrence */

/* Mirror of FSRec.toRRule so a rule written by the app round-trips unchanged. */
function buildRRule_(rep) {
  if (!rep || !rep.freq) return '';
  var freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
  var parts = ['FREQ=' + (freqMap[rep.freq] || 'WEEKLY')];
  var interval = Number(rep.interval || 1);
  if (interval > 1) parts.push('INTERVAL=' + interval);
  if (rep.freq === 'weekly' && rep.byWeekday && rep.byWeekday.length) {
    parts.push('BYDAY=' + rep.byWeekday.map(function (d) { return DOW[Number(d)]; }).join(','));
  }
  if (rep.freq === 'monthly') {
    if (rep.byWeekday && rep.byWeekday.length) {
      parts.push('BYDAY=' + Number(rep.setPos || 1) + DOW[Number(rep.byWeekday[0])]);
    } else if (rep.byMonthDay) {
      parts.push('BYMONTHDAY=' + rep.byMonthDay);
    }
  }
  if (rep.count) parts.push('COUNT=' + rep.count);
  else if (rep.until) parts.push('UNTIL=' + String(rep.until).replace(/-/g, '') + 'T235959Z');
  if (rep.freq === 'weekly') parts.push('WKST=SU');
  return parts.join(';');
}

function recurrence_(item) {
  var rule = '';
  if (item.rrule) rule = String(item.rrule);
  else if (item.repeat && typeof item.repeat === 'object') rule = buildRRule_(item.repeat);
  else if (item.repeat && typeof item.repeat === 'string') rule = String(item.repeat);
  rule = rule.replace(/^RRULE:/i, '').trim();
  return rule ? ['RRULE:' + rule] : [];
}

/* ---------------------------------------------------------------- helpers */

function marker_(id) { return id ? '[flowstate:' + id + ']' : ''; }

function withMarker_(body, id) {
  var text = String(body || '');
  var marker = marker_(id);
  if (!marker || text.indexOf(marker) >= 0) return text;
  return text ? text + '\n' + marker : marker;
}

function stripMarker_(desc) {
  return String(desc || '').replace(/\[flowstate:[^\]]+\]/g, '').replace(/\s+$/, '');
}

function normTitle_(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parse_(v) {
  if (v instanceof Date) return v;
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v || ''));
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 9), Number(m[5] || 0), 0, 0);
}

function fmt_(d) {
  if (!d) return '';
  return Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm");
}

function tz_() {
  return PROPS.getProperty('FLOWSTATE_TZ') || Session.getScriptTimeZone() || 'UTC';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
