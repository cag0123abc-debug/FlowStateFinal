/* FlowState sync engine — dependency-free merge logic for Google Calendar
   two-way sync. Shared by the web app and the test suite.

   Responsibilities:
   - match an incoming remote event to a local item (stable id first, then a
     title+date fingerprint) so the same event is never stored twice;
   - decide add / update / skip / conflict for each remote event;
   - never overwrite a newer local edit with an older remote copy;
   - keep local-only data (skips, overrides, notes, audio, category) intact;
   - gate automatic pulls so they are not spammed.

   It performs no I/O: the caller supplies the item array and a factory, then
   saves/renders itself. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FSSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AUTO_MS = 5 * 60 * 1000;   /* automatic pull cadence */
  var MIN_GAP_MS = 60 * 1000;    /* never auto-pull more often than this */

  function text(v) { return v == null ? '' : String(v); }

  /* Title + start, normalised. Used only as a fallback identity when an event
     has no stable id yet (for example a hand-typed event that also exists in
     Google Calendar). */
  function fingerprint(item) {
    var due = text(item && (item.due || item.start)).trim().slice(0, 16);
    var title = text(item && item.title).replace(/\s+/g, ' ').trim().toLowerCase();
    return title + '|' + due;
  }

  function remoteId(r) { return text(r && (r.uid || r.googleId || r.icsUid)); }

  /* Remote modification time in ms, tolerating ISO strings and epoch numbers. */
  function remoteTime(r) {
    if (!r) return 0;
    var t = r.updated || r.modified || r.lastModified || 0;
    if (typeof t === 'number') return t > 0 ? t : 0;
    var n = Date.parse(t);
    return isNaN(n) ? 0 : n;
  }

  function normaliseRemote(r) {
    if (!r || !text(r.title).trim()) return null;
    return {
      title: text(r.title).trim(),
      body: text(r.body),
      due: text(r.due || r.start),
      uid: remoteId(r),
      calendar: text(r.calendar),
      cat: text(r.cat),
      type: r.type || 'event',
      repeat: r.repeat || r.rrule || null,
      updated: remoteTime(r)
    };
  }

  /* Find the local counterpart of a remote event.
     Returns { item, how: 'uid' | 'fingerprint' } or null. */
  function findMatch(items, remote) {
    var list = items || [];
    var id = remoteId(remote);
    var i;
    if (id) {
      for (i = 0; i < list.length; i++) {
        if (list[i] && (list[i].googleId === id || list[i].uid === id)) {
          return { item: list[i], how: 'uid' };
        }
      }
    }
    var fp = fingerprint({ title: remote.title, due: remote.due || remote.start });
    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || it.deleted) continue;
      if (it.googleId || it.uid) continue;   /* already linked to something else */
      if (fingerprint(it) === fp) return { item: it, how: 'fingerprint' };
    }
    return null;
  }

  /* What should happen to the local collection for this remote event. */
  function decide(items, remote) {
    var n = normaliseRemote(remote);
    if (!n) return { kind: 'skip', reason: 'empty' };

    var match = findMatch(items, n);
    if (!match) return { kind: 'add', remote: n };

    var it = match.item;
    var titleChanged = text(it.title) !== n.title;
    var dueChanged = text(it.due).slice(0, 16) !== n.due.slice(0, 16);
    var bodyChanged = !!n.body && text(it.body) !== n.body;
    var repeatChanged = !!n.repeat && !it.repeat;

    if (!titleChanged && !dueChanged && !bodyChanged && !repeatChanged) {
      return { kind: 'skip', target: it, how: match.how };
    }
    /* Local edit is newer than the remote copy: keep the local version rather
       than silently discarding what the user just typed. */
    if (n.updated && it.updated && Number(it.updated) > n.updated) {
      return { kind: 'conflict', target: it, how: match.how };
    }
    return { kind: 'update', target: it, remote: n, how: match.how };
  }

  function defaultMake(remote, source, now) {
    return {
      id: 'r' + now.toString(36) + Math.random().toString(36).slice(2, 8),
      type: remote.type || 'event',
      cat: remote.cat || 'home',
      title: remote.title,
      body: remote.body || '',
      due: remote.due || '',
      created: now,
      updated: remote.updated || now,
      googleId: remote.uid || '',
      uid: remote.uid || '',
      source: source,
      calendar: remote.calendar || '',
      repeat: remote.repeat || null
    };
  }

  /* Merge a list of remote events into `items` in place.
     opts.make(remote, source, now) lets the caller build a schema-correct item.
     Returns { added, updated, skipped, conflicts, changed }. */
  function mergeInto(items, list, source, opts) {
    opts = opts || {};
    var out = { added: 0, updated: 0, skipped: 0, conflicts: 0, changed: false };
    var make = opts.make || defaultMake;
    var now = opts.now || Date.now();

    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var d = decide(items, raw);
      if (d.kind === 'skip') { out.skipped++; return; }
      if (d.kind === 'conflict') { out.conflicts++; return; }

      if (d.kind === 'add') {
        items.push(make(d.remote, source, now));
        out.added++;
        out.changed = true;
        return;
      }

      /* update: copy syncable fields only, leave local-only data alone */
      var it = d.target, r = d.remote;
      it.title = r.title;
      if (r.due) it.due = r.due;
      if (r.body) it.body = r.body;
      if (r.repeat) it.repeat = r.repeat;
      if (r.calendar) it.calendar = r.calendar;
      it.googleId = it.googleId || r.uid;
      if (!it.uid && r.uid) it.uid = r.uid;
      it.source = it.source || source;
      /* mirror the remote timestamp so a later remote change still applies,
         while a genuinely newer local edit still wins next time */
      it.updated = r.updated || now;
      it.syncedAt = now;
      out.updated++;
      out.changed = true;
    });

    return out;
  }

  /* Should the automatic pull run right now? */
  function shouldAutoPull(settings, now, opts) {
    opts = opts || {};
    if (!settings || !settings.googleSync) return false;
    if (opts.online === false) return false;
    if (opts.configured === false) return false;
    if (opts.busy) return false;
    var last = Number(settings.syncLast || 0);
    if (!last) return true;
    return (now - last) >= (opts.minGapMs || MIN_GAP_MS);
  }

  return {
    AUTO_MS: AUTO_MS,
    MIN_GAP_MS: MIN_GAP_MS,
    fingerprint: fingerprint,
    remoteId: remoteId,
    remoteTime: remoteTime,
    normaliseRemote: normaliseRemote,
    findMatch: findMatch,
    decide: decide,
    mergeInto: mergeInto,
    shouldAutoPull: shouldAutoPull
  };
});
