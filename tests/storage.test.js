 'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const F = require('../storage.js');
const fixture = () => ({
  items: [
    { id: 'assignment', type: 'homework', cls: 'math', due: '2027-02-03T09:00', body: 'Line one\n第二行 🎧', reminders: [10], extra: { preserved: true } },
    { id: 'audio', type: 'recording', cls: 'math', nativeFileId: 'private-audio', transcript: 'Keep attached', duration: 300 }
  ],
  classes: [{ id: 'math', name: 'Math', img: 'data:image/png;base64,AAAA', stickers: ['📚'] }],
  notifs: [], dnd: true, fired: { 'assignment:10': 1 }, settings: { fs: 18, bg: { home: '#abcdef' } },
  recordings: [{ id: 'media', blobKey: 'audio-1', transcript: 'Related' }], images: [{ id: 'cover', blobKey: 'image-1' }],
  bookmarks: [], templates: [], dashboard: [], quotes: [], unknown: { preserve: [null, false, 0, ''] }
});
const code = (work, wanted) => assert.throws(work, e => e instanceof F.StorageError && e.code === wanted);
test('legacy decoding retains every record, relation, reference, setting and unknown field', () => {
  const data = fixture(); assert.deepEqual(F.decode(JSON.stringify(data)).data, data);
});
test('versioned round trip retains unknown payload and envelope fields', () => {
  const data = fixture(), raw = F.encode(data, { revision: 3, savedAt: '2026-11-15T00:00:00Z', envelope: { extension: { keep: 1 } } });
  const result = F.decode(raw); assert.equal(result.revision, 3); assert.equal(result.needsMigration, false);
  assert.deepEqual(result.envelope.extension, { keep: 1 }); assert.deepEqual(result.data, data);
});
test('encoding/decoding neither mutates input nor shares mutable returned references', () => {
  const data = fixture(), before = JSON.stringify(data), out = F.decode(F.encode(data));
  out.data.classes[0].name = 'Changed'; assert.equal(JSON.stringify(data), before);
});
test('intentional empty collections remain empty', () => {
  const data = { items: [], classes: [] }; assert.deepEqual(F.decode(JSON.stringify(data)).data, data);
});
test('orphan class references are preserved with warnings', () => {
  const data = fixture(); data.items[0].cls = 'missing'; const out = F.decode(JSON.stringify(data));
  assert.equal(out.data.items[0].cls, 'missing'); assert.equal(out.warnings[0].code, 'ORPHAN_CLASS_REFERENCE');
});
for (const collection of ['items', 'classes']) test('duplicate ' + collection + ' IDs are rejected without deduplication', () => {
  const data = fixture(); data[collection].push({ ...data[collection][0] }); code(() => F.validate(data), 'DUPLICATE_ID');
});
test('missing and empty identifiers are rejected', () => {
  for (const id of ['', ' ', null, 3]) { const data = fixture(); data.items[0].id = id; code(() => F.validate(data), 'INVALID_ID'); }
});
test('malformed collections and preferences are rejected', () => {
  for (const [key, value] of [['items', null], ['classes', {}], ['notifs', {}], ['settings', []], ['fired', []], ['dnd', 'yes']]) {
    const data = fixture(); data[key] = value; code(() => F.validate(data), 'INVALID_DATA');
  }
});
test('invalid class-reference types are rejected', () => {
  const data = fixture(); data.items[0].cls = {}; code(() => F.validate(data), 'INVALID_REFERENCE');
});
test('invalid reminder structures are rejected', () => {
  const data = fixture(); data.items[0].reminders = {}; code(() => F.validate(data), 'INVALID_DATA');
});
test('corrupt JSON does not become writable defaults', () => code(() => F.decode(' { broken\n'), 'CORRUPT_JSON'));
test('prototype-related keys cannot pollute prototypes', () => {
  code(() => F.decode('{"items":[],"classes":[],"__proto__":{"polluted":true}}'), 'UNSAFE_KEY'); assert.equal({}.polluted, undefined);
});
test('future schemas are rejected before downgrade', () => {
  const data = JSON.parse(F.encode(fixture())); data.schemaVersion = 99; code(() => F.decode(JSON.stringify(data)), 'FUTURE_VERSION');
});
test('invalid schema versions and revisions are rejected', () => {
  for (const [key, value, wanted] of [['schemaVersion', -1, 'INVALID_VERSION'], ['schemaVersion', 0.5, 'INVALID_VERSION'], ['revision', -1, 'INVALID_REVISION']]) {
    const data = JSON.parse(F.encode(fixture())); data[key] = value; code(() => F.decode(JSON.stringify(data)), wanted);
  }
});
test('invalid timestamps cannot be encoded or decoded', () => {
  code(() => F.encode(fixture(), { savedAt: 'not a date' }), 'INVALID_DATE');
  const data = JSON.parse(F.encode(fixture())); data.savedAt = 'broken'; code(() => F.decode(JSON.stringify(data)), 'INVALID_DATE');
});
test('non-JSON values cannot be silently transformed', () => {
  for (const value of [undefined, NaN, Infinity, new Date(), new Map(), () => {}, 1n]) {
    const data = fixture(); data.extra = value; code(() => F.validate(data), 'NOT_JSON');
  }
});
test('cycles are rejected', () => { const data = fixture(); data.loop = data; code(() => F.validate(data), 'CYCLIC_DATA'); });
test('shared noncyclic values are retained', () => {
  const data = fixture(), shared = { x: 1 }; data.a = shared; data.b = shared;
  assert.deepEqual(F.decode(F.encode(data)).data.a, { x: 1 });
});
test('getters are rejected without being invoked', () => {
  const data = fixture(); let calls = 0;
  Object.defineProperty(data, 'getter', { enumerable: true, get() { calls++; return 1; } });
  code(() => F.validate(data), 'NOT_JSON'); assert.equal(calls, 0);
});
test('hidden fields and symbols cannot be lost silently', () => {
  const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: 1 }); code(() => F.validate(hidden), 'NOT_JSON');
  const symbol = fixture(); symbol[Symbol('x')] = 1; code(() => F.validate(symbol), 'NOT_JSON');
});
test('sparse and custom arrays are rejected', () => {
  const data = fixture(); data.extra = Array(3); code(() => F.validate(data), 'NOT_JSON');
  data.extra = [1]; Object.defineProperty(data.extra, 'hidden', { value: 1 }); code(() => F.validate(data), 'NOT_JSON');
});
test('excessive nesting fails safely', () => {
  const data = fixture(); let value = data; for (let n = 0; n < 140; n++) { value.nested = {}; value = value.nested; }
  code(() => F.validate(data), 'TOO_DEEP');
});
test('10,000 records retain stable IDs and relationships', () => {
  const data = fixture(); data.items = Array.from({ length: 10000 }, (_, n) => ({ id: 'item-' + n, cls: 'math', body: 'Text ' + n }));
  const out = F.decode(F.encode(data)); assert.equal(out.data.items.length, 10000); assert.deepEqual(out.data.items[9999], data.items[9999]);
});
test('browser module initializes without storage, DOM, network or native access', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../storage.js'), 'utf8'), context);
  assert.equal(context.FlowStateStorage.VERSION, 1);
});
test('array or primitive envelope extensions cannot produce malformed output', () => {
  for (const value of [[], 'invalid', 42]) code(() => F.encode(fixture(), { envelope: value }), 'INVALID_ENVELOPE');
});
test('version-zero envelope migration preserves payload and extension fields', () => {
  const original = JSON.parse(F.encode(fixture(), { envelope: { extension: { keep: true } } })); original.schemaVersion = 0;
  const decoded = F.decode(JSON.stringify(original)); assert.equal(decoded.needsMigration, true);
  const upgraded = F.decode(F.encode(decoded.data, { envelope: decoded.envelope }));
  assert.deepEqual(upgraded.data, fixture()); assert.deepEqual(upgraded.envelope.extension, { keep: true });
});
