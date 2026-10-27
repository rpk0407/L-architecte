// @ts-check
// An appointment as a calendar file (RFC 5545), attached to the client's e-mail so one tap puts it in their agenda.
// Times are the salon's wall clock with TZID=Europe/Paris and the zone's own rules inside the file, so a phone set to
// another zone still shows 10 h in Marseille. The UID is the appointment's: a move or a cancellation replaces the event.
import { addDays, TZ } from '../../shared/dates.js';

const CRLF = '\r\n';

// the rules of Europe/Paris since 1996 (last Sunday of March and of October), enough for any appointment to come
const PARIS = [
  'BEGIN:VTIMEZONE', 'TZID:' + TZ,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'
];

/** Text values: backslash, comma, semicolon and newlines are escaped. */
export function icsText(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
}
/** '2026-11-03', 600 → '20261103T100000' (local time; minutes past midnight may run into the next day). */
export function icsLocal(day, min) {
  const d = addDays(day, Math.floor(min / 1440)), m = ((min % 1440) + 1440) % 1440;
  return d.replace(/-/g, '') + 'T' + String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0') + '00';
}
/** An instant in UTC: '20261103T091500Z'. */
export function icsUtc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

/** Lines longer than 75 octets are folded (a CRLF and a space), never inside a UTF-8 character. */
export function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join(CRLF + ' ');
}

/**
 * One event in its own calendar. method PUBLISH adds or updates it; CANCEL (with a higher sequence) removes it.
 * @param {{ uid: string, day: string, start: number, dur: number, summary: string, location?: string, description?: string,
 *   url?: string, stamp: number, sequence?: number, cancel?: boolean, organizer?: string }} o
 */
export function buildIcs(o) {
  const ev = [
    'BEGIN:VEVENT', 'UID:' + o.uid, 'DTSTAMP:' + icsUtc(o.stamp), 'SEQUENCE:' + (o.sequence || 0),
    'DTSTART;TZID=' + TZ + ':' + icsLocal(o.day, o.start), 'DTEND;TZID=' + TZ + ':' + icsLocal(o.day, o.start + o.dur),
    'SUMMARY:' + icsText(o.summary),
    ...(o.location ? ['LOCATION:' + icsText(o.location)] : []),
    ...(o.description ? ['DESCRIPTION:' + icsText(o.description)] : []),
    ...(o.url ? ['URL:' + o.url] : []),
    ...(o.organizer ? ['ORGANIZER:mailto:' + o.organizer] : []),
    'STATUS:' + (o.cancel ? 'CANCELLED' : 'CONFIRMED'), 'TRANSP:OPAQUE',
    'END:VEVENT'
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber L\'Architecte//Le Comptoir//FR', 'CALSCALE:GREGORIAN', 'METHOD:' + (o.cancel ? 'CANCEL' : 'PUBLISH'), ...PARIS, ...ev, 'END:VCALENDAR'];
  return lines.map(fold).join(CRLF) + CRLF;
}

/**
 * The calendar file of an appointment: the salon's address, the services and the barber, the "manage" link.
 * @param {{ name: string, address?: string, zip?: string, city?: string }} shop settings.shop
 * @param {{ id: string, day: string, start: number, dur: number, moves?: number, services: { name: string }[] }} a
 * @param {{ barber: string, link?: string, now: number, cancel?: boolean, organizer?: string }} o
 */
export function apptIcs(shop, a, o) {
  const what = a.services.map((x) => x.name).join(' + ');
  const where = [shop.address, [shop.zip, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return buildIcs({
    uid: a.id + '@larchitecte', day: a.day, start: a.start, dur: a.dur, stamp: o.now,
    // a cancellation outranks every version sent before it
    sequence: (a.moves || 0) + (o.cancel ? 1 : 0), cancel: !!o.cancel,
    summary: what + ' · ' + shop.name, location: [shop.name, where].filter(Boolean).join(', '),
    description: 'Avec ' + o.barber + '.' + (o.link && !o.cancel ? '\nDéplacer ou annuler : ' + o.link : ''),
    url: o.cancel ? undefined : o.link || undefined, organizer: o.organizer
  });
}
