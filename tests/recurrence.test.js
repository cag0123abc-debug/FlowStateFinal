/* Regression tests for the FlowState recurrence engine.
   Run: node tests/recurrence.test.js */
const assert = require('assert');
const R = require('../recurrence.js');

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

/* --- multiple weekdays (Wed, Thu, Sat) --- */
test('weekly on Wed/Thu/Sat starts on the anchor', () => {
  const item = { id: 'a', due: '2026-03-04T09:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [3, 4, 6] } };
  const dates = R.seriesDates(item).slice(0, 6);
  assert.deepStrictEqual(dates, ['2026-03-04', '2026-03-05', '2026-03-07', '2026-03-11', '2026-03-12', '2026-03-14']);
});

test('weekly every 2 weeks keeps the week offset', () => {
  const item = { id: 'b', due: '2026-03-02T08:00', repeat: { freq: 'weekly', interval: 2, byWeekday: [1, 3] } };
  const dates = R.seriesDates(item).slice(0, 4);
  assert.deepStrictEqual(dates, ['2026-03-02', '2026-03-04', '2026-03-16', '2026-03-18']);
});

/* --- second Friday of every month --- */
test('monthly second Friday', () => {
  const item = { id: 'c', due: '2026-01-09T10:00', repeat: { freq: 'monthly', interval: 1, byWeekday: [5], setPos: 2 } };
  const dates = R.seriesDates(item).slice(0, 4);
  assert.deepStrictEqual(dates, ['2026-01-09', '2026-02-13', '2026-03-13', '2026-04-10']);
});

test('monthly last Sunday', () => {
  const item = { id: 'c2', due: '2026-01-25T10:00', repeat: { freq: 'monthly', interval: 1, byWeekday: [0], setPos: -1 } };
  const dates = R.seriesDates(item).slice(0, 3);
  assert.deepStrictEqual(dates, ['2026-01-25', '2026-02-22', '2026-03-29']);
});

test('monthly on day 15 every 3 months', () => {
  const item = { id: 'c3', due: '2026-01-15T10:00', repeat: { freq: 'monthly', interval: 3, byMonthDay: 15 } };
  const dates = R.seriesDates(item).slice(0, 3);
  assert.deepStrictEqual(dates, ['2026-01-15', '2026-04-15', '2026-07-15']);
});

/* --- end dates and counts --- */
test('weekly series stops at the end date', () => {
  const item = { id: 'd', due: '2026-03-02T09:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [1], until: '2026-03-23' } };
  assert.deepStrictEqual(R.seriesDates(item), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']);
});

test('count limits the number of occurrences', () => {
  const item = { id: 'e', due: '2026-03-02T09:00', repeat: { freq: 'daily', interval: 1, count: 3 } };
  assert.deepStrictEqual(R.seriesDates(item), ['2026-03-02', '2026-03-03', '2026-03-04']);
});

/* --- skipping and overrides --- */
test('skipped occurrence disappears but series continues', () => {
  const item = { id: 'f', due: '2026-03-02T09:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [1] }, exdates: ['2026-03-09'] };
  const dates = R.occurrences(item, null, new Date(2026, 2, 31)).map(o => o.key);
  assert.deepStrictEqual(dates, ['2026-03-02', '2026-03-16', '2026-03-23', '2026-03-30']);
});

test('override moves one occurrence only', () => {
  const item = { id: 'g', due: '2026-03-02T09:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [1] } };
  R.overrideOccurrence(item, '2026-03-09', { due: '2026-03-10T15:30' });
  const occ = R.occurrences(item);
  assert.strictEqual(occ[0].date.getDate(), 2);
  assert.strictEqual(occ[1].date.getDate(), 10);
  assert.strictEqual(occ[1].date.getHours(), 15);
  assert.strictEqual(occ[2].date.getDate(), 16);
});

test('skipOccurrence is idempotent', () => {
  const item = { id: 'h', due: '2026-03-02T09:00', repeat: { freq: 'daily', interval: 1 } };
  R.skipOccurrence(item, '2026-03-03');
  R.skipOccurrence(item, '2026-03-03');
  assert.deepStrictEqual(item.exdates, ['2026-03-03']);
});

/* --- range expansion --- */
test('expandRange filters by date window and sorts', () => {
  const items = [
    { id: 'i1', due: '2026-03-04T09:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [3] } },
    { id: 'i2', due: '2026-03-05T08:00' }
  ];
  const out = R.expandRange(items, new Date(2026, 2, 1), new Date(2026, 2, 31));
  assert.deepStrictEqual(out.map(o => o.key), ['2026-03-04', '2026-03-05', '2026-03-11', '2026-03-18', '2026-03-25']);
});

/* --- RRULE round trip --- */
test('RRULE round trip for multi weekday and ordinal monthly', () => {
  const weekly = { freq: 'weekly', interval: 1, byWeekday: [3, 4, 6] };
  assert.strictEqual(R.toRRule(weekly), 'FREQ=WEEKLY;BYDAY=WE,TH,SA;WKST=SU');
  assert.deepStrictEqual(R.fromRRule(R.toRRule(weekly)).byWeekday, [3, 4, 6]);

  const monthly = { freq: 'monthly', interval: 1, byWeekday: [5], setPos: 2 };
  assert.strictEqual(R.toRRule(monthly), 'FREQ=MONTHLY;BYDAY=2FR');
  const back = R.fromRRule('FREQ=MONTHLY;BYDAY=2FR');
  assert.strictEqual(back.setPos, 2);
  assert.deepStrictEqual(back.byWeekday, [5]);
});

test('UNTIL is written and read back', () => {
  const rep = { freq: 'weekly', interval: 1, byWeekday: [1], until: '2026-05-01' };
  const rule = R.toRRule(rep);
  assert.ok(rule.indexOf('UNTIL=20260501') > -1, rule);
  assert.strictEqual(R.fromRRule(rule).until, '2026-05-01');
});

/* --- descriptions --- */
test('describeRepeat is human readable', () => {
  assert.strictEqual(R.describeRepeat({ freq: 'weekly', interval: 1, byWeekday: [3, 4, 6] }), 'Every week on Wed, Thu, Sat');
  assert.strictEqual(R.describeRepeat({ freq: 'monthly', interval: 1, byWeekday: [5], setPos: 2 }), 'Every month on the 2nd Fri');
  assert.strictEqual(R.describeRepeat(null), 'Does not repeat');
});

/* --- ICS --- */
test('ICS export contains RRULE and EXDATE', () => {
  const item = { id: 'j', title: 'Study group', due: '2026-03-04T17:00', repeat: { freq: 'weekly', interval: 1, byWeekday: [3, 6] }, exdates: ['2026-03-07'] };
  const lines = R.icsEvent(item).join('\r\n');
  assert.ok(lines.indexOf('RRULE:FREQ=WEEKLY;BYDAY=WE,SA;WKST=SU') > -1, lines);
  assert.ok(lines.indexOf('EXDATE:') > -1, lines);
  assert.ok(lines.indexOf('SUMMARY:Study group') > -1, lines);
});

test('ICS import reads title, start and repeat', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc@google.com', 'SUMMARY:Chem lab', 'DTSTART:20260306T140000', 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const [ev] = R.parseICS(ics);
  assert.strictEqual(ev.title, 'Chem lab');
  assert.strictEqual(ev.due, '2026-03-06T14:00');
  assert.deepStrictEqual(ev.repeat.byWeekday, [5]);
  assert.strictEqual(ev.uid, 'abc@google.com');
});

test('nthWeekday handles short months', () => {
  assert.strictEqual(R.nthWeekday(2026, 1, 5, 5), null);
  assert.strictEqual(R.dk(R.nthWeekday(2026, 1, 5, 2)), '2026-02-13');
});

console.log('\n' + passed + ' recurrence tests passed');
