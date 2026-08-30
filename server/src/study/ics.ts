/**
 * iCalendar export for assigned learning-path deadlines — pure builder so
 * it's unit-testable. All-day events (due date), UTC stamps, CRLF lines
 * per RFC 5545.
 */

export interface IcsAssignment {
  uid: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  url?: string;
}

function esc(s: string): string {
  return (s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function stampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildAssignmentsICS(items: IcsAssignment[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SET//Learning Paths//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const it of items) {
    const start = it.dueDate.replace(/-/g, '');
    const end = new Date(Date.parse(`${it.dueDate}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}@set`,
      `DTSTAMP:${stampNow()}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`, // exclusive end = day after the deadline
      `SUMMARY:${esc(`${it.title} — due`)}`,
      ...(it.url ? [`URL:${it.url}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
