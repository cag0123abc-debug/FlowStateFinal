/* Regression tests for the FlowState Google Calendar sync merge logic.
   Run: node tests/sync.test.js */
const assert = require('assert');
const S = require('../sync-engine.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    console.error('      ' + err.message);
    process.exitCode = 1;
  }
}

const NOW = 1770000000000;

/* --- adding and identifying --- */
test('a new Google event is added once', () => {
  const items = [];
  const r = S.mergeInto(items, [{ uid: 'g1', title: 'Chem lab', due: '2026-03-06T14:00', calendar: 'School' }], 'google', { now: NOW });
  assert.strictEqual(r.added, 1);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].googleId, 'g1');
  assert.strictEqual(items[0].source, 'google');
  assert.strictEqual(items[0].calendar, 'School');
});

test('the same event pulled twice does not duplicate', () => {
  const items = [];
  const ev = { uid: 'g1', title: 'Chem lab', due: '2026-03-06T14:00' };
  S.mergeInto(items, [ev], 'google', { now: NOW });
  const r = S.mergeInto(items, [ev], 'google', { now: NOW + 1000 });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.skipped, 1);
});

test('a local event with no id is matched by title and date, not duplicated', () => {
  const items = [{ id: 'l1', title: 'Chem  lab ', due: '2026-03-06T14:00', cat: 'school' }];
  const r = S.mergeInto(items, [{ uid: 'g1', title: 'Chem lab', due: '2026-03-06T14:00' }], 'google', { now: NOW });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(items[0].googleId, 'g1');   /* now linked to Google */
  assert.strictEqual(items[0].cat, 'school');    /* local category kept */
});

test('an .ics import followed by a Google pull does not duplicate', () => {
  const items = [];
  S.mergeInto(items, [{ uid: 'abc@google.com', title: 'Chem lab', due: '2026-03-06T14:00' }], 'ics', { now: NOW });
  const r = S.mergeInto(items, [{ uid: 'abc@google.com', title: 'Chem lab', due: '2026-03-06T14:00' }], 'google', { now: NOW });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(items[0].source, 'ics');    /* origin stays identifiable */
});

/* --- updates --- */
test('a changed remote title updates the local event', () => {
  const items = [{ id: 'l1', googleId: 'g1', title: 'Chem lab', due: '2026-03-06T14:00', updated: 1 }];
  const r = S.mergeInto(items, [{ uid: 'g1', title: 'Chem lab (moved room)', due: '2026-03-06T14:00', updated: '2026-03-01T10:00:00Z' }], 'google', { now: NOW });
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(items[0].title, 'Chem lab (moved room)');
});

test('a newer local edit is not clobbered by an older remote copy', () => {
  const localTime = Date.parse('2026-03-10T12:00:00Z');
  const items = [{ id: 'l1', googleId: 'g1', title: 'Mine', due: '2026-03-06T14:00', updated: localTime }];
  const r = S.mergeInto(items, [{ uid: 'g1', title: 'Theirs', due: '2026-03-06T14:00', updated: '2026-03-01T10:00:00Z' }], 'google', { now: NOW });
  assert.strictEqual(r.conflicts, 1);
  assert.strictEqual(r.updated, 0);
  assert.strictEqual(items[0].title, 'Mine');
});

test('after accepting a remote update, a later remote change still applies', () => {
  const items = [{ id: 'l1', googleId: 'g1', title: 'v1', due: '2026-03-06T14:00', updated: 1 }];
  S.mergeInto(items, [{ uid: 'g1', title: 'v2', due: '2026-03-06T14:00', updated: '2026-03-01T10:00:00Z' }], 'google', { now: NOW });
  const r = S.mergeInto(items, [{ uid: 'g1', title: 'v3', due: '2026-03-06T14:00', updated: '2026-03-02T10:00:00Z' }], 'google', { now: NOW + 1000 });
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(items[0].title, 'v3');
});

test('local-only data survives a remote update', () => {
  const items = [{
    id: 'l1', googleId: 'g1', title: 'Study group', due: '2026-03-04T17:00',
    cat: 'school', exdates: ['2026-03-11'], overrides: { '2026-03-18': { due: '2026-03-19T10:00' } },
    reminders: [15], body: 'notes', updated: 1
  }];
  S.mergeInto(items, [{ uid: 'g1', title: 'Study group', due: '2026-03-04T18:00', updated: '2026-03-01T10:00:00Z' }], 'google', { now: NOW });
  assert.strictEqual(items[0].due, '2026-03-04T18:00');
  assert.deepStrictEqual(items[0].exdates, ['2026-03-11']);
  assert.deepStrictEqual(items[0].reminders, [15]);
  assert.strictEqual(items[0].overrides['2026-03-18'].due, '2026-03-19T10:00');
  assert.strictEqual(items[0].cat, 'school');
});

test('a recurring series keeps its repeat rule', () => {
  const items = [];
  S.mergeInto(items, [{
    uid: 'g2', title: 'Lab', due: '2026-03-04T09:00',
    repeat: { freq: 'weekly', interval: 1, byWeekday: [3, 4, 6] }
  }], 'google', { now: NOW });
  assert.deepStrictEqual(items[0].repeat.byWeekday, [3, 4, 6]);
});

test('malformed remote rows are ignored', () => {
  const items = [];
  const r = S.mergeInto(items, [null, {}, { title: '   ' }, { uid: 'g1', title: 'Real', due: '2026-03-06T14:00' }], 'google', { now: NOW });
  assert.strictEqual(r.added, 1);
  assert.strictEqual(items.length, 1);
});

/* --- decisions --- */
test('decide reports add, update, skip and conflict', () => {
  const items = [
    { id: 'a', googleId: 'g1', title: 'Same', due: '2026-03-06T14:00', updated: 5 },
    { id: 'b', googleId: 'g2', title: 'Old', due: '2026-03-07T14:00', updated: 5 }
  ];
  assert.strictEqual(S.decide(items, { uid: 'g9', title: 'New', due: '2026-03-08T14:00' }).kind, 'add');
  assert.strictEqual(S.decide(items, { uid: 'g1', title: 'Same', due: '2026-03-06T14:00' }).kind, 'skip');
  assert.strictEqual(S.decide(items, { uid: 'g2', title: 'Changed', due: '2026-03-07T14:00', updated: '2026-03-09T00:00:00Z' }).kind, 'update');
  assert.strictEqual(S.decide(items, { uid: 'g2', title: 'Changed', due: '2026-03-07T14:00', updated: '2026-01-01T00:00:00Z' }).kind, 'conflict');
});

test('fingerprint normalises case and whitespace', () => {
  assert.strictEqual(
    S.fingerprint({ title: '  CHEM   Lab ', due: '2026-03-06T14:00:00' }),
    S.fingerprint({ title: 'chem lab', due: '2026-03-06T14:00' })
  );
});

/* --- automatic pull gating --- */
test('auto pull is off unless sync is on, online and configured', () => {
  const on = { googleSync: true, syncLast: 0 };
  assert.strictEqual(S.shouldAutoPull({ googleSync: false }, NOW), false);
  assert.strictEqual(S.shouldAutoPull(on, NOW, { online: false }), false);
  assert.strictEqual(S.shouldAutoPull(on, NOW, { configured: false }), false);
  assert.strictEqual(S.shouldAutoPull(on, NOW, { busy: true }), false);
  assert.strictEqual(S.shouldAutoPull(on, NOW), true);   /* never synced yet */
});

test('auto pull respects the minimum gap', () => {
  const s = { googleSync: true, syncLast: NOW - 30 * 1000 };
  assert.strictEqual(S.shouldAutoPull(s, NOW), false);
  assert.strictEqual(S.shouldAutoPull({ googleSync: true, syncLast: NOW - 2 * 60 * 1000 }, NOW), true);
});

test('cadence is a few minutes, not seconds', () => {
  assert.ok(S.AUTO_MS >= 60 * 1000);
  assert.ok(S.MIN_GAP_MS >= 30 * 1000);
});

console.log('\n' + passed + ' sync tests passed');
