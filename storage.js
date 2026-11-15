/* FlowState metadata protocol. No storage, network, DOM, or native access. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'FlowStateStorage', { value: api });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'flowstate.metadata';
  const VERSION = 1;
  const KEY = 'flowstate-metadata-v1';
  const LEGACY_KEYS = Object.freeze(['flowstate-v3', 'flowstate-v2', 'flowstate']);

  class StorageError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'FlowStateStorageError';
      this.code = code;
    }
  }
  function fail(code, message) { throw new StorageError(code, message); }
  function isRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function checkJSON(value) {
    const active = new Set();
    const stack = [{ value, depth: 0 }];
    while (stack.length) {
      const item = stack.pop(), current = item.value;
      if (item.leave) { active.delete(current); continue; }
      if (item.depth > 128) fail('TOO_DEEP', 'Metadata nesting requires manual recovery.');
      if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
      if (typeof current === 'number' && Number.isFinite(current)) continue;
      if (typeof current !== 'object' || (!Array.isArray(current) && !isRecord(current))) {
        fail('NOT_JSON', 'Only finite JSON values can be preserved.');
      }
      if (active.has(current)) fail('CYCLIC_DATA', 'Reference cycles cannot be stored.');
      active.add(current);
      stack.push({ value: current, leave: true });
      if (Object.getOwnPropertySymbols(current).length) fail('NOT_JSON', 'Symbol fields cannot be preserved.');
      if (Array.isArray(current)) {
        if (Object.keys(current).length !== current.length || Object.getOwnPropertyNames(current).length !== current.length + 1) {
          fail('NOT_JSON', 'Sparse or custom arrays require review.');
        }
        for (let n = current.length - 1; n >= 0; n--) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(n));
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('NOT_JSON', 'Accessors are unsupported.');
          stack.push({ value: descriptor.value, depth: item.depth + 1 });
        }
      } else {
        for (const key of Object.getOwnPropertyNames(current)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) {
            fail('UNSAFE_KEY', 'Prototype-related fields require review; original data must be retained.');
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            fail('NOT_JSON', 'Hidden fields and accessors cannot be preserved.');
          }
          stack.push({ value: descriptor.value, depth: item.depth + 1 });
        }
      }
    }
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  function validate(data) {
    checkJSON(data);
    if (!isRecord(data) || !Array.isArray(data.items) || !Array.isArray(data.classes)) {
      fail('INVALID_DATA', 'Metadata requires items and classes arrays.');
    }
    for (const key of ['notifs', 'templates', 'images', 'bookmarks', 'recordings', 'quotes', 'dashboard']) {
      if (Object.prototype.hasOwnProperty.call(data, key) && !Array.isArray(data[key])) fail('INVALID_DATA', 'A stored collection is not an array.');
    }
    for (const key of ['settings', 'fired']) {
      if (Object.prototype.hasOwnProperty.call(data, key) && !isRecord(data[key])) fail('INVALID_DATA', 'A settings or reminder map is invalid.');
    }
    if (Object.prototype.hasOwnProperty.call(data, 'dnd') && typeof data.dnd !== 'boolean') fail('INVALID_DATA', 'The notification preference is invalid.');
    for (const key of ['items', 'classes']) {
      const ids = new Set();
      for (const row of data[key]) {
        if (!isRecord(row) || typeof row.id !== 'string' || !row.id.trim()) fail('INVALID_ID', 'A stable identifier is missing.');
        if (ids.has(row.id)) fail('DUPLICATE_ID', 'Duplicate identifiers require review; no records were removed.');
        ids.add(row.id);
      }
    }
    const classIds = new Set(data.classes.map(row => row.id)), warnings = [];
    for (const row of data.items) {
      if (row.reminders != null && !Array.isArray(row.reminders)) fail('INVALID_DATA', 'Reminder offsets must be an array.');
      if (row.cls != null && typeof row.cls !== 'string') fail('INVALID_REFERENCE', 'A class reference is invalid.');
      if (row.cls && !classIds.has(row.cls)) warnings.push({ code: 'ORPHAN_CLASS_REFERENCE', itemId: row.id, classId: row.cls });
    }
    return warnings;
  }
  function decode(raw) {
    if (typeof raw !== 'string') fail('INVALID_INPUT', 'Metadata must be JSON text.');
    let document;
    try { document = JSON.parse(raw); }
    catch (_) { fail('CORRUPT_JSON', 'Stored JSON is damaged; original text must not be replaced.'); }
    if (isRecord(document) && document.format === FORMAT && Number.isSafeInteger(document.schemaVersion) && document.schemaVersion > VERSION) {
      fail('FUTURE_VERSION', 'A newer app schema must not be overwritten.');
    }
    checkJSON(document);
    if (isRecord(document) && document.format === FORMAT) {
      if (!Number.isSafeInteger(document.schemaVersion) || document.schemaVersion < 0) fail('INVALID_VERSION', 'The schema version is invalid.');
      if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('INVALID_REVISION', 'The revision is invalid.');
      if (typeof document.savedAt !== 'string' || Number.isNaN(Date.parse(document.savedAt))) fail('INVALID_DATE', 'The stored timestamp is invalid.');
      const warnings = validate(document.data);
      return { data: copy(document.data), version: VERSION, fromVersion: document.schemaVersion, revision: document.revision,
        envelope: copy(document), warnings, needsMigration: document.schemaVersion !== VERSION };
    }
    const warnings = validate(document);
    return { data: copy(document), version: VERSION, fromVersion: 0, revision: 0, envelope: null, warnings, needsMigration: true };
  }
  function encode(data, options) {
    options = options || {};
    validate(data);
    const revision = options.revision == null ? 1 : options.revision;
    const savedAt = options.savedAt || new Date().toISOString();
    if (!Number.isSafeInteger(revision) || revision < 1) fail('INVALID_REVISION', 'The next revision is invalid.');
    if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) fail('INVALID_DATE', 'The save timestamp is invalid.');
    if (options.envelope != null && !isRecord(options.envelope)) fail('INVALID_ENVELOPE', 'Envelope extensions must be an object.');
    if (options.envelope) checkJSON(options.envelope);
    const result = options.envelope ? copy(options.envelope) : {};
    result.format = FORMAT; result.schemaVersion = VERSION;
    result.revision = revision; result.savedAt = savedAt; result.data = copy(data);
    return JSON.stringify(result);
  }
  return Object.freeze({ FORMAT, VERSION, KEY, LEGACY_KEYS, StorageError, validate, decode, encode });
});
