/* FlowState recurrence engine — dependency-free, shared by the web app and tests.
   Supports: daily / weekly (multiple weekdays) / monthly (day-of-month or
   "second Friday" style ordinal weekdays) / yearly, custom intervals,
   end dates (UNTIL) or occurrence counts (COUNT), skipped dates (EXDATE)
   and single-occurrence overrides. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FSRec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  var DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function dk(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function timeOf(s) {
    var m = /T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? [+m[1], +m[2]] : [9, 0];
  }

  function withTime(dateKey, hh, mm) {
    var d = parseDate(dateKey);
    if (!d) return null;
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d;
  }

  /* nth weekday of a month: n = 1..5, or -1 for last */
  function nthWeekday(year, month, weekday, n) {
    if (n > 0) {
      var first = new Date(year, month, 1);
      var offset = (weekday - first.getDay() + 7) % 7;
      var d = new Date(year, month, 1 + offset + (n - 1) * 7);
      return d.getMonth() === month ? d : null;
    }
    var last = new Date(year, month + 1, 0);
    var off = (last.getDay() - weekday + 7) % 7;
    var dl = new Date(year, month, last.getDate() - off + (n + 1) * 7);
    return dl.getMonth() === month ? dl : null;
  }

  function normalise(rep) {
    if (!rep || !rep.freq) return null;
    var r = {
      freq: rep.freq,
      interval: Math.max(1, parseInt(rep.interval, 10) || 1),
      byWeekday: Array.isArray(rep.byWeekday) ? rep.byWeekday.map(Number).filter(function (d) { return d >= 0 && d <= 6; }).sort(function (a, b) { return a - b; }) : [],
      byMonthDay: rep.byMonthDay ? Math.min(31, Math.max(1, parseInt(rep.byMonthDay, 10))) : null,
      setPos: rep.setPos ? parseInt(rep.setPos, 10) : null,
      until: rep.until || null,
      count: rep.count ? Math.max(1, parseInt(rep.count, 10)) : null
    };
    if (!r.byWeekday.length) delete r.byWeekday;
    return r;
  }

  /* All occurrence date keys for an item, from its anchor forward (bounded). */
  function seriesDates(item) {
    var anchor = parseDate(item && item.due);
    if (!anchor) return [];
    var rep = normalise(item.repeat);
    if (!rep) return [dk(anchor)];

    var out = [];
    var guard = 1500;
    var until = rep.until ? parseDate(rep.until) : null;
    var maxCount = rep.count || 0;
    var i, d, base, y, m;

    function push(dateObj) {
      if (!dateObj || isNaN(dateObj)) return;
      if (dateObj < anchor) return;
      if (until && dateObj > until) return;
      if (maxCount && out.length >= maxCount) return;
      out.push(dk(dateObj));
    }

    if (rep.freq === 'daily') {
      for (i = 0; i < guard; i++) {
        d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i * rep.interval);
        if (until && d > until) break;
        if (maxCount && out.length >= maxCount) break;
        push(d);
      }
    } else if (rep.freq === 'weekly') {
      var days = rep.byWeekday && rep.byWeekday.length ? rep.byWeekday : [anchor.getDay()];
      var weekStart = new Date(anchor);
      weekStart.setDate(anchor.getDate() - anchor.getDay());
      for (i = 0; i < guard; i++) {
        var moved = false;
        for (var k = 0; k < days.length; k++) {
          d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i * 7 * rep.interval + days[k]);
          if (d < anchor) continue;
          if (until && d > until) continue;
          if (maxCount && out.length >= maxCount) break;
          out.push(dk(d));
          moved = true;
        }
        if (until && new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i * 7 * rep.interval) > until) break;
        if (maxCount && out.length >= maxCount) break;
        if (!moved && i > 400) break;
      }
    } else if (rep.freq === 'monthly') {
      for (i = 0; i < guard; i++) {
        base = new Date(anchor.getFullYear(), anchor.getMonth() + i * rep.interval, 1);
        y = base.getFullYear(); m = base.getMonth();
        if (until && base > until) break;
        if (maxCount && out.length >= maxCount) break;
        var candidates = [];
        if (rep.byWeekday && rep.byWeekday.length) {
          var pos = rep.setPos || 1;
          for (var w = 0; w < rep.byWeekday.length; w++) {
            var nd = nthWeekday(y, m, rep.byWeekday[w], pos);
            if (nd) candidates.push(nd);
          }
        } else if (rep.byMonthDay) {
          candidates.push(new Date(y, m, rep.byMonthDay));
        } else {
          candidates.push(new Date(y, m, anchor.getDate()));
        }
        candidates.sort(function (a, b) { return a - b; });
        for (var c = 0; c < candidates.length; c++) push(candidates[c]);
      }
    } else if (rep.freq === 'yearly') {
      for (i = 0; i < guard; i++) {
        base = new Date(anchor.getFullYear() + i * rep.interval, anchor.getMonth(), anchor.getDate());
        if (until && base > until) break;
        if (maxCount && out.length >= maxCount) break;
        push(base);
      }
    } else {
      out.push(dk(anchor));
    }

    /* de-duplicate, keep chronological */
    var seen = Object.create(null), clean = [];
    out.sort();
    for (i = 0; i < out.length; i++) {
      if (seen[out[i]]) continue;
      seen[out[i]] = 1;
      clean.push(out[i]);
    }
    return clean;
  }

  /* Occurrences of one item, with time-of-day applied, exdates removed,
     overrides merged. from/to are Dates (inclusive). */
  function occurrences(item, from, to) {
    var dates = seriesDates(item);
    var ex = item && item.exdates ? item.exdates : [];
    var ov = (item && item.overrides) || {};
    var t = timeOf(item && item.due);
    var out = [];
    for (var i = 0; i < dates.length; i++) {
      var key = dates[i];
      if (ex.indexOf(key) >= 0) continue;
      var when = withTime(key, t[0], t[1]);
      if (!when) continue;
      var override = ov[key] || null;
      if (override) {
        if (override.skipped) continue;
        if (override.due) when = new Date(override.due);
      }
      if (from && when < from) continue;
      if (to && when > to) continue;
      out.push({ key: key, date: when, override: override, item: item });
    }
    return out;
  }

  /* Flatten many items into one chronological list of occurrences. */
  function expandRange(items, from, to) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it || it.deleted) return;
      occurrences(it, from, to).forEach(function (o) { out.push(o); });
    });
    out.sort(function (a, b) { return a.date - b.date; });
    return out;
  }

  /* Skip a single occurrence without deleting the series. */
  function skipOccurrence(item, dateKey) {
    if (!item) return item;
    item.exdates = Array.isArray(item.exdates) ? item.exdates : [];
    if (item.exdates.indexOf(dateKey) < 0) item.exdates.push(dateKey);
    if (item.overrides && item.overrides[dateKey]) delete item.overrides[dateKey];
    return item;
  }

  function overrideOccurrence(item, dateKey, patch) {
    if (!item) return item;
    item.overrides = item.overrides || {};
    item.overrides[dateKey] = Object.assign({}, item.overrides[dateKey] || {}, patch);
    return item;
  }

  /* ---------- RRULE <-> repeat object ---------- */

  function toRRule(rep, anchorKey) {
    var r = normalise(rep);
    if (!r) return null;
    var parts = [];
    var freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
    parts.push('FREQ=' + (freqMap[r.freq] || 'WEEKLY'));
    if (r.interval > 1) parts.push('INTERVAL=' + r.interval);
    if (r.freq === 'weekly' && r.byWeekday && r.byWeekday.length) {
      parts.push('BYDAY=' + r.byWeekday.map(function (d) { return DOW[d]; }).join(','));
    }
    if (r.freq === 'monthly') {
      if (r.byWeekday && r.byWeekday.length) {
        var pos = r.setPos || 1;
        parts.push('BYDAY=' + pos + DOW[r.byWeekday[0]]);
      } else if (r.byMonthDay) {
        parts.push('BYMONTHDAY=' + r.byMonthDay);
      }
    }
    if (r.count) parts.push('COUNT=' + r.count);
    else if (r.until) parts.push('UNTIL=' + String(r.until).replace(/-/g, '') + 'T235959Z');
    if (r.freq === 'weekly') parts.push('WKST=SU');
    return parts.join(';');
  }

  function fromRRule(str) {
    if (!str) return null;
    var out = { freq: 'weekly', interval: 1, byWeekday: [], byMonthDay: null, setPos: null, until: null, count: null };
    String(str).toUpperCase().split(';').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0], v = kv[1];
      if (!v) return;
      if (k === 'FREQ') {
        var map = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
        out.freq = map[v] || 'weekly';
      } else if (k === 'INTERVAL') out.interval = parseInt(v, 10) || 1;
      else if (k === 'COUNT') out.count = parseInt(v, 10) || null;
      else if (k === 'UNTIL') {
        var m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
        if (m) out.until = m[1] + '-' + m[2] + '-' + m[3];
      } else if (k === 'BYDAY') {
        v.split(',').forEach(function (tok) {
          var mm = /^(-?\d)?([A-Z]{2})$/.exec(tok.trim());
          if (!mm) return;
          var idx = DOW.indexOf(mm[2]);
          if (idx < 0) return;
          out.byWeekday.push(idx);
          if (mm[1]) out.setPos = parseInt(mm[1], 10);
        });
      } else if (k === 'BYMONTHDAY') out.byMonthDay = parseInt(v, 10) || null;
    });
    if (!out.byWeekday.length) delete out.byWeekday;
    return out;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function describeRepeat(rep) {
    var r = normalise(rep);
    if (!r) return 'Does not repeat';
    var text;
    var weekdays = function () { return (r.byWeekday || []).map(function (d) { return DOW_NAME[d]; }).join(', '); };
    if (r.freq === 'daily') text = r.interval === 1 ? 'Every day' : 'Every ' + r.interval + ' days';
    else if (r.freq === 'weekly') {
      text = (r.interval === 1 ? 'Every week' : 'Every ' + r.interval + ' weeks');
      if (r.byWeekday && r.byWeekday.length) text += ' on ' + weekdays();
    } else if (r.freq === 'monthly') {
      var every = r.interval === 1 ? 'Every month' : 'Every ' + r.interval + ' months';
      if (r.byWeekday && r.byWeekday.length) text = every + ' on the ' + ordinal(r.setPos || 1) + ' ' + DOW_NAME[r.byWeekday[0]];
      else if (r.byMonthDay) text = every + ' on day ' + r.byMonthDay;
      else text = every;
    } else if (r.freq === 'yearly') {
      text = r.interval === 1 ? 'Every year' : 'Every ' + r.interval + ' years';
    } else text = 'Repeats';
    if (r.count) text += ' · ' + r.count + ' times';
    else if (r.until) text += ' · until ' + r.until;
    return text;
  }

  /* ---------- ICS ---------- */

  function icsDate(d) {
    var off = -d.getTimezoneOffset();
    var local = new Date(d.getTime() + off * 60000);
    return local.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /* Build VEVENT lines for one item (series aware). */
  function icsEvent(item, opts) {
    opts = opts || {};
    var anchor = parseDate(item.due);
    if (!anchor) return [];
    var t = timeOf(item.due);
    var start = withTime(dk(anchor), t[0], t[1]);
    var minutes = opts.minutes || 60;
    var end = new Date(start.getTime() + minutes * 60000);
    var lines = ['BEGIN:VEVENT', 'UID:' + (item.uid || item.id) + '@flowstate', 'DTSTAMP:' + icsDate(new Date()), 'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end), 'SUMMARY:' + icsEscape(item.title)];
    if (item.body) lines.push('DESCRIPTION:' + icsEscape(item.body));
    if (item.location) lines.push('LOCATION:' + icsEscape(item.location));
    var rule = toRRule(item.repeat, dk(anchor));
    if (rule) lines.push('RRULE:' + rule);
    if (item.exdates && item.exdates.length) {
      lines.push('EXDATE:' + item.exdates.map(function (k) { var d = withTime(k, t[0], t[1]); return d ? icsDate(d) : null; }).filter(Boolean).join(','));
    }
    (item.reminders || []).forEach(function (m) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(item.title), 'TRIGGER:-PT' + m + 'M', 'END:VALARM');
    });
    lines.push('END:VEVENT');
    return lines;
  }

  /* Minimal ICS reader: returns [{title, body, due, repeat, uid}] */
  function parseICS(text) {
    if (!text) return [];
    var unfolded = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
    var lines = unfolded.split('\n');
    var events = [], cur = null;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (line === 'BEGIN:VEVENT') { cur = {}; return; }
      if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; return; }
      if (!cur) return;
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var key = line.slice(0, idx).split(';')[0].toUpperCase();
      var val = line.slice(idx + 1);
      if (key === 'SUMMARY') cur.title = val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
      else if (key === 'DESCRIPTION') cur.body = val.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
      else if (key === 'LOCATION') cur.location = val;
      else if (key === 'UID') cur.uid = val;
      else if (key === 'DTSTART') {
        var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(val);
        if (m) cur.due = m[1] + '-' + m[2] + '-' + m[3] + 'T' + (m[4] || '09') + ':' + (m[5] || '00');
      } else if (key === 'RRULE') cur.repeat = fromRRule(val);
    });
    return events.filter(function (e) { return e.title && e.due; }).map(function (e) {
      return { title: e.title, body: e.body || '', due: e.due, repeat: e.repeat || null, location: e.location || '', uid: e.uid || '' };
    });
  }

  return {
    DOW: DOW,
    DOW_NAME: DOW_NAME,
    MONTH_NAME: MONTH_NAME,
    pad: pad,
    dk: dk,
    parseDate: parseDate,
    timeOf: timeOf,
    withTime: withTime,
    nthWeekday: nthWeekday,
    normalise: normalise,
    seriesDates: seriesDates,
    occurrences: occurrences,
    expandRange: expandRange,
    skipOccurrence: skipOccurrence,
    overrideOccurrence: overrideOccurrence,
    toRRule: toRRule,
    fromRRule: fromRRule,
    describeRepeat: describeRepeat,
    icsDate: icsDate,
    icsEvent: icsEvent,
    parseICS: parseICS
  };
});
