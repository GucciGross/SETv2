import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssignmentsICS } from '../src/study/ics.ts';

test('ics: all-day VEVENTs with exclusive next-day DTEND, CRLF lines', () => {
  const ics = buildAssignmentsICS([
    { uid: 'path-1', title: 'Robot Safety; Unit A', dueDate: '2026-09-15', url: 'https://set.example/app/space/s/paths' },
  ]);
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260915/);
  assert.match(ics, /DTEND;VALUE=DATE:20260916/);
  assert.match(ics, /SUMMARY:Robot Safety\\; Unit A — due/);
  assert.match(ics, /URL:https:\/\/set\.example\/app\/space\/s\/paths/);
  assert.match(ics, /UID:path-1@set/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/(?<!\r)\n/.test(ics)); // strictly CRLF — no bare LF anywhere
});

test('ics: empty roster still emits a valid calendar', () => {
  const ics = buildAssignmentsICS([]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok(!ics.includes('VEVENT'));
});
