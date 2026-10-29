// Reading the old WordPress salon's exports in the browser (Salon Booking System): the bookings CSV of
// Salon › Calendrier, the optional WXR of Outils › Exporter (no-shows, notes, the secret of old e-mail links),
// the plugin's customer CSV, and two small CSVs typed by hand for paper gift cards and running subscriptions.
// Nothing leaves the browser before the owner has seen the preview; the server decides again (commands/import.js).
// Self-contained (plain TypeScript, no other .ts import), so the unit tests run it in Node as is.
// @ts-ignore: plain JS module with JSDoc types
import * as D from '../../../shared/dates.js';
// @ts-ignore: plain JS module with JSDoc types
import * as PH from '../../../shared/phone.js';
// @ts-ignore: plain JS module with JSDoc types
import * as EM from '../../../shared/email.js';
// @ts-ignore: plain JS module with JSDoc types
import { retentionCutoff } from '../../../shared/retention.js';

const dates = D as { instantOf(day: string, min: number): number; isDay(s: string): boolean; addDays(key: string, n: number): string; localParts(ms: number): { day: string }; dayParts(key: string): { y: number; m: number; d: number } };

export type WpStatus = 'confirmed' | 'pending' | 'pendingpayment' | 'paid' | 'paylater' | 'canceled' | 'error';
export type WpBooking = {
  wp: number; uniq?: string; day: string; start: number; dur?: number; createdAt?: number;
  first: string; last: string; email: string; phone: string; prefix?: string;
  services: string[]; staff: string; price: number | null; paid: number; status: WpStatus; noShow: boolean; note: string;
  /** the WordPress customer id (a site pull gives it; the exports do not) */
  wpUser?: number;
};
export type WpClient = { first: string; last: string; email: string; phone: string; prefix?: string; notes: string; wpUser?: number };
export type WpGift = { code: string; amount: number; expires?: string };
export type WpPack = { phone: string; first: string; last: string; left: number; expires: string };
export type FileKind = 'bookings' | 'wxr' | 'customers' | 'giftcards' | 'packs' | 'unknown';
/** The first lines of a bookings file as they were read: what the owner checks before anything is sent. */
export type SampleRow = { wp: number; day: string; start: number; name: string; services: string[]; staff: string; price: number | null };
/**
 * rows: read and kept; dupes: the same booking read again (the newest file wins); bad: lines that could not be read (each has a Problem);
 * window: the period a bookings CSV says it covers; why: what is wrong with a file that brought nothing, and the cure; info: not an error,
 * what the reader did on the way; first/last/ahead: the days the bookings span and how many are still to come; cut: an XML that stops short;
 * order: how the numeric dates were read ('md' month first, 'unsure' nothing proves it, 'mixed' both orders occur).
 */
export type FileReport = {
  name: string; kind: FileKind; rows: number; dupes?: number; bad?: number; window?: Period; why?: string; info?: string;
  first?: string; last?: string; ahead?: number; cut?: boolean; order?: 'md' | 'unsure' | 'mixed'; sample?: SampleRow[];
  /** the file's own date (File.lastModified) and the newest creation time among its bookings: how fresh an export is */
  at?: number; newest?: number;
};
export type Period = { from: string; to: string };
export type Problem = { file: string; line: number; text: string; kind?: 'status-unknown'; wp?: number };
export type Parsed = {
  bookings: WpBooking[]; clients: WpClient[]; giftcards: WpGift[]; packs: WpPack[]; files: FileReport[]; problems: Problem[];
  /** the periods the files cover (a CSV with its « de / à » preamble); WXR and a CSV without one cover nothing */
  windows: Period[];
  /** ids of bookings read badly (date, state): they exist in the export, so they are never taken for deleted ones */
  unreadable: Set<number>;
};

/* ---------------- small readers ---------------- */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** RFC 4180, as PHP's fputcsv writes it: quotes doubled, line breaks allowed inside quotes. */
export function parseCsv(text: string, sep?: string): string[][] { return csvRows(text, sep).rows; }
/** The same, with the line of the file each row starts on (1-based: a quoted cell may span lines, blank lines count). */
export function csvRows(text: string, sep?: string): { rows: string[][]; at: number[] } {
  text = text.replace(/^﻿/, '');
  const d = sep || sniff(text);
  const rows: string[][] = [], at: number[] = [];
  let row: string[] = [], cell = '', q = false, line = 1, from = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++; cell += ch; }
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); at.push(from); row = []; cell = ''; line++; from = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); at.push(from); }
  return { rows, at };
}
/** The separator the first lines use most, outside quotes: ',' (the plugin), ';' (French Excel) or a tab. */
function sniff(text: string) {
  const head = text.split(/\r?\n/).slice(0, 6).join('\n').replace(/"[^"]*"/g, '');
  const n = (c: string) => head.split(c).length;
  return n(';') > n(',') && n(';') >= n('\t') ? ';' : n('\t') > n(',') ? '\t' : ',';
}

const MONTHS: [RegExp, number][] = [
  [/^(jan|janv)/, 1], [/^(fev|feb)/, 2], [/^mar/, 3], [/^(avr|apr)/, 4], [/^(mai|may)/, 5], [/^(juin|jun)/, 6],
  [/^(juil|jul)/, 7], [/^(aou|aug)/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^(dec)/, 12]
];
const pad = (n: number) => (n < 10 ? '0' : '') + n;

/**
 * "12 Déc 2025 14:30", "12/12/2025 14h30", "2025-12-12 14:30" → { day, min } (shop-local time). Numbers only are day first
 * (France), unless `monthFirst` (an English Excel round trip); a number above 12 settles the order of its own line.
 */
export function parseWhen(raw: string, o: { monthFirst?: boolean } = {}): { day: string; min: number } | null {
  const s = fold(raw).replace(/ | /g, ' ');
  let y = 0, m = 0, d = 0;
  let rest = '';
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(s);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; rest = x[4]; }
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(.*)$/.exec(s))) {
    d = +x[1]; m = +x[2]; y = +x[3]; rest = x[4];
    if (m > 12 || (o.monthFirst && d <= 12)) { const t = d; d = m; m = t; }
  }
  else if ((x = /^(?:[a-z]+\.?,?\s+)?(\d{1,2})(?:er)?\s+([a-z]+)\.?,?\s+(\d{4})(.*)$/.exec(s))) {
    const mo = MONTHS.find(([re]) => re.test(x![2]));
    if (!mo) return null;
    d = +x[1]; m = mo[1]; y = +x[3]; rest = x[4];
  } else if ((x = /^(?:[a-z]+\.?,?\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(.*)$/.exec(s))) {
    // an English WordPress: "Nov 12, 2026 2:30 pm"
    const mo = MONTHS.find(([re]) => re.test(x![1]));
    if (!mo) return null;
    d = +x[2]; m = mo[1]; y = +x[3]; rest = x[4];
  } else return null;
  const day = y + '-' + pad(m) + '-' + pad(d);
  // '31 Juin' would roll over to 1 July: the day must exist in its month
  const check = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || d < 1 || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || !dates.isDay(day)) return null;
  const t = /(\d{1,2})\s*(?::|h)\s*(\d{2})?\s*(am|pm)?/.exec(rest);
  let h = t ? +t[1] : 0;
  const mi = t && t[2] ? +t[2] : 0;
  if (t && t[3] === 'pm' && h < 12) h += 12;
  if (t && t[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { day, min: h * 60 + mi };
}

/** "40 €", "1 234,50 €", "40.10", "€40.00" → cents; null when there is no amount. */
export function parseMoney(raw: string): number | null {
  const s = String(raw || '').replace(/[\s  €$]|eur(os?)?/gi, '');
  const x = /-?\d[\d.,]*/.exec(s);
  if (!x) return null;
  let n = x[0];
  const dot = n.lastIndexOf('.'), comma = n.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) n = dot > comma ? n.replace(/,/g, '') : n.replace(/\./g, '').replace(',', '.');
  else if (comma >= 0) n = /,\d{1,2}$/.test(n) ? n.replace(/\.(?=\d{3})/g, '').replace(',', '.') : n.replace(/,/g, '');
  else if (dot >= 0 && !/\.\d{1,2}$/.test(n)) n = n.replace(/\./g, '');
  const v = Math.round(parseFloat(n) * 100);
  return Number.isFinite(v) ? v : null;
}
/** The plugin's total: "40 € (10 € déjà payé en acompte)" → { price: 4000, deposit: 1000 }. */
export function parsePrice(raw: string): { price: number | null; deposit: number } {
  const m = /^([^(]*)\((.*)\)/.exec(String(raw || ''));
  if (!m) return { price: parseMoney(raw), deposit: 0 };
  return { price: parseMoney(m[1]), deposit: parseMoney(m[2]) || 0 };
}

const STATUS: [RegExp, WpStatus][] = [
  [/^(sln-b-)?(paiement en attente|pending ?payment|pendingpayment)/, 'pendingpayment'], [/^(sln-b-)?(payer plus tard|pay ?later|paylater)/, 'paylater'],
  [/^(sln-b-)?(confirme|confirmed)/, 'confirmed'], [/^(sln-b-)?(en attente|pending)/, 'pending'], [/^(sln-b-)?(payant|paye|paid)/, 'paid'],
  [/^(sln-b-)?(annule|cancell?ed)/, 'canceled'], [/^(sln-b-)?(erreur|error)/, 'error']
];
export function parseStatus(raw: string): WpStatus | null {
  const s = fold(raw);
  const hit = STATUS.find(([re]) => re.test(s));
  return hit ? hit[1] : null;
}

/** The server's own rules (shared/phone.js): the preview reads numbers exactly as the import will. */
export const normPhoneImport = PH.normPhoneImport as (raw: string, prefix?: string) => string | null;
const isEmail = EM.isEmail as (e: string) => boolean;

/* ---------------- headers: French or English, as the plugin translates them ---------------- */

const H = (s: string) => fold(s).replace(/[^a-z0-9/]+/g, ' ').trim();
const BOOKING_HEADERS: Record<string, string[]> = {
  id: ['id'], when: ['date/heure', 'date/time', 'date heure', 'date'], created: ['cree', 'created', 'cree le', 'date de creation'],
  first: ['prenom du client', 'customer first name', 'prenom', 'first name'], last: ['nom du client', 'customer last name', 'nom', 'last name'],
  email: ['e mail du client', 'email du client', 'customer email', 'e mail', 'email'], phone: ['tel du client', 'telephone du client', 'customer phone', 'telephone', 'tel', 'phone'],
  services: ['services', 'service'], staff: ['assistants', 'assistant', 'attendants', 'attendant', 'barbier'], price: ['prix total', 'total price', 'prix', 'total'],
  status: ['etat', 'status', 'statut']
};
const CUSTOMER_HEADERS: Record<string, string[]> = {
  first: ['first name', 'prenom'], last: ['last name', 'nom'], email: ['email', 'e mail'], phone: ['mobile phone', 'phone', 'telephone', 'tel'], notes: ['personal note', 'note', 'notes']
};
const GIFT_HEADERS: Record<string, string[]> = { code: ['code'], amount: ['solde', 'montant', 'balance', 'amount'], expires: ['expire le', 'expiration', 'expire', 'valable jusqu au'] };
const PACK_HEADERS: Record<string, string[]> = {
  phone: ['telephone', 'tel', 'phone', 'mobile'], left: ['coupes restantes', 'restantes', 'cuts left'], expires: ['expire le', 'expiration', 'expire'], first: ['prenom', 'first name'], last: ['nom', 'last name']
};

function columns(row: string[], table: Record<string, string[]>) {
  const hs = row.map(H);
  const out: Record<string, number> = {};
  for (const [k, names] of Object.entries(table)) {
    const i = hs.findIndex((h) => names.includes(h));
    if (i >= 0) out[k] = i;
  }
  return out;
}
/** The first of the first rows whose cells name these columns (the bookings export starts with a 3-row preamble; a server may print PHP notices above it). */
function findHeader(rows: string[][], table: Record<string, string[]>, need: string[]) {
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const c = columns(rows[i], table);
    if (need.every((k) => k in c)) return { at: i, c };
  }
  return null;
}

function localDay(raw: string): string | undefined {
  const w = parseWhen(raw);
  return w ? w.day : undefined;
}

/* ---------------- WXR (Outils › Exporter) ---------------- */

const unxml = (s: string) => {
  // WordPress writes a `]]>` inside a note as `]]]]><![CDATA[>`: joined back before the section is read
  const c = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>'));
  if (c) return c[1];
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
};
const tag = (xml: string, name: string) => { const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(xml); return m ? unxml(m[1]) : ''; };

/**
 * PHP's serialize(), the little of it WordPress meta uses: arrays, strings (lengths in UTF-8 bytes), numbers, booleans, null.
 * Returns undefined on anything else rather than guessing.
 */
export function unserialize(src: string): unknown {
  const b = new TextEncoder().encode(src);
  const dec = new TextDecoder();
  let i = 0;
  const until = (ch: string) => { const j = b.indexOf(ch.charCodeAt(0), i); if (j < 0) throw new Error('php'); const v = dec.decode(b.subarray(i, j)); i = j + 1; return v; };
  const read = (): unknown => {
    const t = String.fromCharCode(b[i]); i += 2;
    if (t === 'N') return null;
    if (t === 'b') return until(';') === '1';
    if (t === 'i') return parseInt(until(';'), 10);
    if (t === 'd') return parseFloat(until(';'));
    if (t === 's') { const n = +until(':'); i++; const v = dec.decode(b.subarray(i, i + n)); i += n + 2; return v; }
    if (t === 'a') {
      const n = +until(':'); i++;
      const o: Record<string, unknown> = {};
      for (let k = 0; k < n; k++) { const key = read(); o[String(key)] = read(); }
      i++;
      return o;
    }
    throw new Error('php');
  };
  try { return read(); } catch { return undefined; }
}

type WxrBooking = Partial<WpBooking> & { wp: number };
const STATUS_UNKNOWN = 'État inconnu sur l’ancien site : ligne ignorée';
/** A name of a service or a barber as the server keeps it: one line, 80 characters at most. */
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);
/** A creation time worth keeping: between 2000 and 2100 (the old site prints 0000-00-00 for a draft). Later than now is dropped when the rows are cut (`toRows`, with the clock) and by the server. */
const sane = (ms: number) => (Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : undefined);
/** A WordPress post id: a whole number from 1 to 12 digits. */
const wpIdOf = (raw: string) => { const t = raw.trim(); return /^\d{1,12}$/.test(t) && +t > 0 ? +t : 0; };
/** What the plugin leaves in the trash or as a draft is not a booking: gone, not unreadable. */
const DELETED = /^(trash|auto-draft|draft)$/i;

function readWxr(text: string, problems: Problem[], file: string): { list: WxrBooking[]; bad: number; trashed: number } {
  let bad = 0, trashed = 0;
  const items = text.split(/<item>/).slice(1).map((x) => x.split('</item>')[0]);
  const titles = new Map<string, string>();
  for (const it of items) { const type = tag(it, 'wp:post_type'); if (type === 'sln_service' || type === 'sln_attendant') titles.set(tag(it, 'wp:post_id'), clean(tag(it, 'title'))); }
  const out: WxrBooking[] = [];
  for (const it of items) {
    if (tag(it, 'wp:post_type') !== 'sln_booking') continue;
    const wp = wpIdOf(tag(it, 'wp:post_id'));
    if (!wp) { bad++; problems.push({ file, line: 0, text: 'Ligne sans ID' }); continue; }
    const rawStatus = tag(it, 'wp:status').trim();
    // a booking in the trash or still a draft is a deleted one: not read, not counted as unreadable
    if (DELETED.test(rawStatus)) { trashed++; continue; }
    const meta = new Map<string, string>();
    for (const m of it.split(/<wp:postmeta>/).slice(1)) meta.set(tag(m, 'wp:meta_key'), tag(m, 'wp:meta_value'));
    const g = (k: string) => (meta.get('_sln_booking_' + k) || '').trim();
    const st = parseStatus(rawStatus);
    // a status the plugin does not know: never guessed, said
    if (!st) { bad++; problems.push({ file, line: 0, wp, kind: 'status-unknown', text: 'Réservation n° ' + wp + ' : ' + STATUS_UNKNOWN }); continue; }
    const svc = unserialize(g('services'));
    const lines = svc && typeof svc === 'object' ? Object.values(svc as Record<string, any>).filter((x) => x && typeof x === 'object') : [];
    const services = lines.map((l) => titles.get(String(l.service)) || '').filter(Boolean);
    const att = lines.map((l) => titles.get(String(l.attendant)) || '').find(Boolean) || titles.get(g('attendant')) || '';
    const dur = lines.reduce((t, l) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(l.duration || '')); return t + (m ? +m[1] * 60 + +m[2] : 0); }, 0);
    // 25:99 is no time of day: the row is left without one (and reported as unreadable when the CSV does not have it)
    const time = /^(\d{1,2}):(\d{2})/.exec(g('time'));
    const amount = g('amount') ? Math.round(parseFloat(g('amount')) * 100) : null;
    const deposit = g('deposit') ? Math.round(parseFloat(g('deposit')) * 100) : 0;
    const created = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(tag(it, 'wp:post_date_gmt'));
    const b: WxrBooking = { wp, noShow: g('no_show') === '1' };
    if (/^[A-Za-z0-9]{6,64}$/.test(g('uniqid'))) b.uniq = g('uniqid');
    if (g('sms_prefix')) b.prefix = g('sms_prefix');
    // the client's note, then the salon's private one (marked: the agenda must not present it as the client's own words)
    const note = [g('note'), g('admin_note') ? 'Interne : ' + g('admin_note') : ''].filter(Boolean).join(' · ');
    if (note) b.note = note;
    if (dur) b.dur = dur;
    if (dates.isDay(g('date')) && time && +time[1] <= 23 && +time[2] <= 59) { b.day = g('date'); b.start = +time[1] * 60 + +time[2]; }
    if (created) b.createdAt = sane(Date.UTC(+created[1], +created[2] - 1, +created[3], +created[4], +created[5]));
    b.status = st;
    if (g('firstname')) b.first = g('firstname');
    if (g('lastname')) b.last = g('lastname');
    if (g('email')) b.email = g('email');
    if (g('phone')) b.phone = g('phone');
    if (services.length) b.services = services;
    if (att) b.staff = att;
    if (amount != null && Number.isFinite(amount)) { b.price = amount; b.paid = deposit || (st === 'paid' ? amount : 0); }
    out.push(b);
  }
  if (!out.length && !bad && !trashed) problems.push({ file, line: 0, text: 'Aucune réservation dans ce fichier WordPress (type sln_booking).' });
  // an export of the bookings alone names no service nor barber: the bookings the CSV lacks could not be taken
  else if (out.length && !titles.size) problems.push({ file, line: 0, text: 'Ni prestations ni barbiers dans ce fichier : refais l’export avec « Tout le contenu »' });
  return { list: out, bad, trashed };
}

/* ---------------- reading the bytes of a file ---------------- */

/**
 * The text of a file's bytes, whatever program saved it: UTF-16 (Excel's « Texte Unicode », with or without its mark), UTF-8,
 * a file where some lines are UTF-8 and others Windows-1252 (a paste into an old export), Windows-1252, and, when the bookings
 * header only shows up that way, Mac Roman. A UTF-8 mark is dropped.
 */
export function decodeBytes(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2));
  if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2));
  // UTF-16 without its mark: a NUL at every second byte of the first 200
  const n = Math.min(u.length, 200);
  let nul = 0, nulOdd = 0;
  for (let i = 0; i < n; i++) if (u[i] === 0) { if (i % 2) nulOdd++; else nul++; }
  if (n >= 20 && nulOdd > n * 0.3 && nulOdd >= nul * 4) return new TextDecoder('utf-16le').decode(u);
  if (n >= 20 && nul > n * 0.3 && nul >= nulOdd * 4) return new TextDecoder('utf-16be').decode(u);
  const strict = new TextDecoder('utf-8', { fatal: true });
  try { return strict.decode(u).replace(/^﻿/, ''); } catch { /* not UTF-8 all through */ }
  // some lines UTF-8, the others Windows-1252: each line on its own
  const win = new TextDecoder('windows-1252');
  const lines: string[] = [];
  for (let from = 0, i = 0; i <= u.length; i++) {
    if (i < u.length && u[i] !== 0x0a) continue;
    const seg = u.subarray(from, i);
    try { lines.push(strict.decode(seg)); } catch { lines.push(win.decode(seg)); }
    from = i + 1;
  }
  const text = lines.join('\n').replace(/^﻿/, '');
  // Mac Roman, only when Windows-1252 does not find a header in the file and Mac Roman does
  if (!hasHeader(text)) { const mac = new TextDecoder('macintosh').decode(u); if (hasHeader(mac)) return mac; }
  return text;
}
const hasHeader = (t: string) => { const f = readFiles([{ name: '', text: t }]).files[0]; return f.kind !== 'unknown' && f.rows > 0; };

/** Does the start of this file (its first 64 KB, read as text) look like the XML of Outils › Exporter? Then it is read as a stream. */
export const isWxrHead = (head: string): boolean => xmlAt(head) >= 0;
/** Does the start of this file look like the XML of Outils › Exporter (a server may print PHP notices above it)? */
function xmlAt(head: string): number {
  const m = /<\?xml|<rss[\s>]/.exec(head);
  if (!m) return -1;
  return m.index < 400 || /^\s*(<br ?\/?>|<b>|(Warning|Deprecated|Notice|Fatal error)\s*:)/i.test(head) ? m.index : -1;
}
/** « Warning: … » or « <br /><b>Notice</b>: … » at the start of an export: what PHP printed above the data. */
const PHP_NOISE = /^\s*(<br ?\/?>|<b>|(Warning|Deprecated|Notice|Fatal error)\s*:)/i;
const NOISE_INFO = 'WordPress a ajouté des messages d’erreur au début du fichier : ignorés';

/**
 * The XML of a long history is tens of MB, most of it pages and pictures the import never reads. Reads the file as a stream and
 * keeps only the bookings, services and barbers (the items of the types the plugin writes), so memory stays bounded by the largest
 * single item. The result is a small XML for `readFiles`; it ends without `</channel></rss>` when the file did (a cut export).
 */
export async function shrinkWxr(blob: { stream(): ReadableStream<Uint8Array> }): Promise<{ text: string; ended: boolean; items: number }> {
  const dec = new TextDecoder('utf-8');
  const reader = blob.stream().getReader();
  const kept: string[] = [];
  const KEEP = /<wp:post_type>\s*(?:<!\[CDATA\[)?\s*(sln_booking|sln_service|sln_attendant)\s*(?:\]\]>)?\s*<\/wp:post_type>/;
  // buf holds the item being read (from its <item>) or the last few characters, where a tag may straddle two chunks
  let buf = '', tail = '', items = 0, inItem = false, from = 0;
  const drain = () => {
    for (;;) {
      if (!inItem) {
        const a = buf.indexOf('<item>');
        if (a < 0) { buf = buf.slice(-8); return; }
        buf = buf.slice(a); inItem = true; from = 6;
      }
      const b = buf.indexOf('</item>', from);
      if (b < 0) { from = Math.max(6, buf.length - 7); return; }
      items++;
      const item = buf.slice(0, b + 7);
      if (KEEP.test(item)) kept.push(item);
      buf = buf.slice(b + 7); inItem = false;
    }
  };
  for (;;) {
    const r = await reader.read();
    const chunk = r.done ? dec.decode() : dec.decode(r.value, { stream: true });
    tail = (tail + chunk).slice(-4000);
    buf += chunk;
    drain();
    if (r.done) break;
  }
  const ended = tail.includes('</channel>');
  return { text: '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' + kept.join('\n') + (ended ? '</channel></rss>' : ''), ended, items };
}

/* ---------------- everything at once ---------------- */

/** What the owner is told when a dropped file is not an export, with the way out. */
function refusal(text: string): string | null {
  if (!text.trim()) return 'Le fichier est vide : l’export a été coupé ? Refais-le.';
  const head = text.slice(0, 8);
  if (text.startsWith('PK\u0003\u0004')) return /xl\/|\[Content_Types\]|worksheets/.test(text.slice(0, 4000)) ? 'Fichier Excel : ouvre-le puis Fichier > Enregistrer sous > CSV UTF-8, et dépose ce CSV.' : 'Ce n’est pas un export WordPress (une archive ZIP) : décompresse-la et dépose le fichier CSV ou XML.';
  if (head.startsWith('%PDF') || /^(‰PNG|\u0089PNG)/.test(head) || head.startsWith('ÿØÿ') || head.startsWith('GIF8')) return 'Ce n’est pas un export WordPress (un PDF ou une image).';
  if (/^\s*(<!doctype html|<html)/i.test(text.slice(0, 200))) return 'WordPress a renvoyé sa page de connexion : reconnecte-toi puis refais l’export.';
  if (/^\s*(\{\s*"|\[\s*[{"])/.test(text)) return 'Ce n’est pas un export WordPress (du JSON).';
  return null;
}

/** How a file writes its numeric dates: 'dm' (day first), 'md' (an English Excel), or what the lines prove to be both / neither. */
function dateOrder(cells: string[]): 'dm' | 'md' | 'mixed' | 'unsure' | null {
  let dm = 0, md = 0, amb = 0;
  for (const raw of cells) {
    const x = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/.exec(fold(raw));
    if (!x) continue;
    const a = +x[1], b = +x[2];
    if (a > 12 && b <= 12) dm++; else if (b > 12 && a <= 12) md++; else if (a <= 12 && b <= 12 && a !== b) amb++;
  }
  if (md && dm) return 'mixed';
  if (md) return 'md';
  if (dm) return 'dm';
  return amb ? 'unsure' : null;
}

/** The pseudo-name of the services of a booking whose services cell is empty: it gets its own row in the matching step. */
export const NO_SERVICE = '(prestation non indiquée)';

/**
 * Reads every dropped file and merges them: bookings deduplicated by ID across files (the most recently modified file
 * wins, then the first dropped), the WXR filling in what the CSV lacks. `today` (a shop-local day) says which bookings are to come.
 */
export function readFiles(files: { name: string; text: string; modified?: number }[], today = dates.localParts(Date.now()).day): Parsed {
  const problems: Problem[] = [];
  const reports: FileReport[] = [];
  const csv = new Map<number, WpBooking>();
  /** where each booking was read: the report it counts in, and that file's date */
  const src = new Map<number, { rep: number; mod: number }>();
  const unreadable = new Set<number>();
  const wxr: (WxrBooking & { rep: number })[] = [];
  const clients: WpClient[] = [], giftcards: WpGift[] = [], packs: WpPack[] = [];
  const windows: Period[] = [];
  const samples = new Map<number, SampleRow[]>();
  /** the date of each dropped file, by the index of its report */
  const fileMod = new Map<number, number>();
  for (const f of files) {
    fileMod.set(reports.length, f.modified || 0);
    const text = f.text.replace(/^﻿/, '');
    const noise = PHP_NOISE.test(text) ? NOISE_INFO : '';
    const no = refusal(text);
    if (no) { reports.push({ name: f.name, kind: 'unknown', rows: 0, why: no }); continue; }
    const at0 = xmlAt(text.slice(0, 65536));
    if (at0 >= 0) {
      const xml = text.slice(at0);
      const { list, bad, trashed } = readWxr(xml, problems, f.name);
      const ended = xml.slice(-4000).includes('</channel>');
      wxr.push(...list.map((w) => ({ ...w, rep: reports.length })));
      const info = [noise, trashed ? trashed + (trashed > 1 ? ' réservations à la corbeille ou en brouillon sur l’ancien site : ignorées' : ' réservation à la corbeille ou en brouillon sur l’ancien site : ignorée') : ''].filter(Boolean).join(' · ');
      reports.push({ name: f.name, kind: 'wxr', rows: list.length, ...(bad ? { bad } : {}), ...(ended ? {} : { cut: true }), ...(info ? { info } : {}), ...(!list.length && !bad && !trashed ? { why: 'Aucune réservation dans ce fichier' } : {}) });
      continue;
    }
    const { rows: all, at: lineAt } = csvRows(text);
    const keep = all.map((r, i) => i).filter((i) => all[i].some((c) => c.trim() !== ''));
    const rows = keep.map((i) => all[i]);
    const lineOf = (i: number) => lineAt[keep[i]];
    const cell = (r: string[], i: number | undefined) => (i == null ? '' : (r[i] || '').trim());
    let h = findHeader(rows, BOOKING_HEADERS, ['id', 'when']);
    if (h) {
      let n = 0, dupes = 0, bad = 0;
      const mod = f.modified || 0;
      const order = h.c.when != null ? dateOrder(rows.slice(h.at + 1).map((r) => cell(r, h!.c.when))) : null;
      const monthFirst = order === 'md';
      const sample: SampleRow[] = [];
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i], c = h.c;
        const wp = wpIdOf(cell(r, c.id));
        const line = lineOf(i);
        if (!wp) { problems.push({ file: f.name, line, text: 'Ligne sans ID' }); bad++; continue; }
        // the same booking in two exports: the one read from the most recently modified file stands
        const prior = src.get(wp);
        if (prior && !(mod > prior.mod)) { dupes++; continue; }
        const when = parseWhen(cell(r, c.when), { monthFirst });
        const status = parseStatus(cell(r, c.status));
        if (!when) { problems.push({ file: f.name, line, wp, text: 'Date illisible : « ' + cell(r, c.when).replace(/\s+/g, ' ').slice(0, 40) + ' »' }); bad++; unreadable.add(wp); continue; }
        if (!status) { problems.push({ file: f.name, line, wp, text: 'État inconnu : « ' + cell(r, c.status).replace(/\s+/g, ' ').slice(0, 40) + ' »' }); bad++; unreadable.add(wp); continue; }
        if (prior) { const old = reports[prior.rep]; old.rows--; old.dupes = (old.dupes || 0) + 1; }
        const created = cell(r, c.created) ? parseWhen(cell(r, c.created), { monthFirst }) : null;
        const { price, deposit } = parsePrice(cell(r, c.price));
        const services = cell(r, c.services).split(/\s*,\s*/).map(clean).filter(Boolean);
        const b: WpBooking = {
          wp, day: when.day, start: when.min, createdAt: created ? sane(dates.instantOf(created.day, created.min)) : undefined,
          first: cell(r, c.first), last: cell(r, c.last), email: cell(r, c.email).toLowerCase(), phone: cell(r, c.phone),
          services: services.length ? services : [NO_SERVICE], staff: clean(cell(r, c.staff).split(/\s*,\s*/)[0] || ''),
          // a deposit paid online counts whatever the status ('Confirmé' with '(10 € déjà payé en acompte)')
          price, paid: deposit || (status === 'paid' ? price || 0 : 0), status, noShow: false, note: ''
        };
        csv.set(wp, b);
        src.set(wp, { rep: reports.length, mod });
        if (sample.length < 3) sample.push({ wp, day: b.day, start: b.start, name: [b.first, b.last].filter(Boolean).join(' '), services: services, staff: b.staff, price });
        n++;
      }
      // « Réservations · de · à » above the header: the period this export covers (what is missing from it, inside, was deleted)
      let window: Period | undefined;
      for (const r of rows.slice(0, h.at)) {
        const from = r[1] ? parseWhen(r[1], { monthFirst }) : null, to = r[2] ? parseWhen(r[2], { monthFirst }) : null;
        if (from && to && from.day <= to.day) { window = { from: from.day, to: to.day }; break; }
      }
      if (window) windows.push(window);
      const dateInfo = order === 'md' ? 'Dates lues mois/jour/année (un jour au-dessus de 12 ne se trouve qu’en deuxième position)' : '';
      const info = [noise, dateInfo].filter(Boolean).join(' · ');
      if (sample.length) samples.set(reports.length, sample);
      reports.push({
        name: f.name, kind: 'bookings', rows: n, dupes, ...(bad ? { bad } : {}), ...(window ? { window } : {}), ...(info ? { info } : {}),
        ...(order === 'md' || order === 'mixed' || order === 'unsure' ? { order } : {}), ...(!n && !bad && !dupes ? { why: 'Aucune ligne dans ce fichier' } : {})
      });
      continue;
    }
    if ((h = findHeader(rows, GIFT_HEADERS, ['code', 'amount']))) {
      let n = 0, bad = 0;
      const width = rows[h.at].length;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i], line = lineOf(i);
        const amount = parseMoney(cell(r, h.c.amount));
        const last4 = (cell(r, h.c.code) || '').replace(/[^A-Za-z0-9]/g, '').slice(-4);
        // « 50,00 » unquoted in a comma file reads as two cells: the balance and the date would slide one column
        if (r.length > width && r.slice(width).some((x) => x.trim() !== '')) { problems.push({ file: f.name, line, text: 'Carte •••• ' + last4 + ' : colonnes en trop, mets le montant entre guillemets' }); bad++; continue; }
        if (!cell(r, h.c.code) || amount == null) { problems.push({ file: f.name, line, text: 'Carte sans code ou sans solde' }); bad++; continue; }
        if (amount < 0 || amount > 100000) { problems.push({ file: f.name, line, text: 'Carte •••• ' + last4 + ' : solde hors limites (1 000 € au plus), reprends-la à la caisse' }); bad++; continue; }
        const exp = cell(r, h.c.expires);
        const expires = exp ? localDay(exp) : undefined;
        // a date that is there but unreadable is never replaced by « dans un an »
        if (exp && !expires) { problems.push({ file: f.name, line, text: 'Carte •••• ' + last4 + ' : date d’expiration illisible (« ' + exp.slice(0, 20) + ' »)' }); bad++; continue; }
        giftcards.push({ code: cell(r, h.c.code), amount, ...(expires ? { expires } : {}) });
        n++;
      }
      reports.push({ name: f.name, kind: 'giftcards', rows: n, ...(bad ? { bad } : {}), ...(noise ? { info: noise } : {}), ...(!n && !bad ? { why: 'Aucune ligne dans ce fichier' } : {}) });
      continue;
    }
    if ((h = findHeader(rows, PACK_HEADERS, ['phone', 'left']))) {
      let n = 0, bad = 0;
      const width = rows[h.at].length;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i], line = lineOf(i);
        const digits = cell(r, h.c.phone).replace(/\D/g, '');
        const left = parseInt(cell(r, h.c.left), 10);
        const expires = localDay(cell(r, h.c.expires));
        const who = '•••• ' + digits.slice(-4);
        if (r.length > width && r.slice(width).some((x) => x.trim() !== '')) { problems.push({ file: f.name, line, text: 'Carnet ' + who + ' : colonnes en trop' }); bad++; continue; }
        if (!(left > 0) || !expires) { problems.push({ file: f.name, line, text: 'Carnet ' + who + ' : sans coupes restantes ou sans date d’expiration' }); bad++; continue; }
        if (left > 50) { problems.push({ file: f.name, line, text: 'Carnet ' + who + ' : plus de 50 coupes restantes, vérifie le nombre' }); bad++; continue; }
        packs.push({ phone: cell(r, h.c.phone), first: cell(r, h.c.first), last: cell(r, h.c.last), left, expires });
        n++;
      }
      reports.push({ name: f.name, kind: 'packs', rows: n, ...(bad ? { bad } : {}), ...(noise ? { info: noise } : {}), ...(!n && !bad ? { why: 'Aucune ligne dans ce fichier' } : {}) });
      continue;
    }
    if ((h = findHeader(rows, CUSTOMER_HEADERS, ['first', 'email']) || findHeader(rows, CUSTOMER_HEADERS, ['first', 'phone']))) {
      let n = 0;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i];
        const x = { first: cell(r, h.c.first), last: cell(r, h.c.last), email: cell(r, h.c.email).toLowerCase(), phone: cell(r, h.c.phone), notes: cell(r, h.c.notes) };
        if (!x.phone && !x.email) continue;
        clients.push(x);
        n++;
      }
      reports.push({ name: f.name, kind: 'customers', rows: n, ...(noise ? { info: noise } : {}), ...(!n ? { why: 'Aucune ligne dans ce fichier' } : {}) });
      continue;
    }
    reports.push({ name: f.name, kind: 'unknown', rows: 0, why: 'Colonnes non reconnues : ce n’est pas un export de Salon Booking System (il faut ID, DATE/HEURE, SERVICES… en première ligne).' });
  }
  // the WXR fills in what the CSV does not have; a booking only in the WXR is taken from it when complete
  const repOf = new Map<number, number>([...src].map(([wp, v]) => [wp, v.rep]));
  for (const w of wxr) {
    const b = csv.get(w.wp);
    if (b) {
      if (w.uniq) b.uniq = w.uniq;
      if (w.prefix) b.prefix = w.prefix;
      if (w.note) b.note = w.note;
      if (w.dur) b.dur = w.dur;
      if (w.noShow) b.noShow = true;
      // a deposit only the WXR knows (the CSV prints it for « Payant » only)
      if (w.paid && !b.paid) b.paid = w.paid;
      if (b.price == null && w.price != null) b.price = w.price;
      if (!b.phone && w.phone) b.phone = w.phone;
      if (!b.email && w.email) b.email = w.email.toLowerCase();
    } else if (w.day && w.start != null && w.status && w.services && w.services.length) {
      const { rep, ...rest } = w;
      csv.set(w.wp, { first: '', last: '', phone: '', staff: '', price: null, paid: 0, noShow: false, note: '', ...rest, email: (w.email || '').toLowerCase() } as WpBooking);
      repOf.set(w.wp, rep);
    } else {
      // not in the CSV and not complete enough to book: counted as unreadable, not silently dropped
      const rep = reports[w.rep];
      rep.rows--; rep.bad = (rep.bad || 0) + 1;
      unreadable.add(w.wp);
      problems.push({ file: rep.name, line: 0, wp: w.wp, text: 'Réservation n° ' + w.wp + ' : sans date, prestation ou état lisibles dans le fichier XML, ignorée' });
    }
  }
  const bookings = [...csv.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.start - b.start));
  // the days each file spans, and how many of its bookings are still to come
  for (const b of bookings) {
    const rep = reports[repOf.get(b.wp) ?? -1];
    if (!rep) continue;
    if (!rep.first || b.day < rep.first) rep.first = b.day;
    if (!rep.last || b.day > rep.last) rep.last = b.day;
    if (b.day >= today) rep.ahead = (rep.ahead || 0) + 1;
    if (b.createdAt && (!rep.newest || b.createdAt > rep.newest)) rep.newest = b.createdAt;
  }
  reports.forEach((r, i) => { const m = fileMod.get(i) || 0; if (m) r.at = m; });
  // the customers' file alone brings nobody in: with no booking, retention leaves every one of them out
  if (!bookings.length) for (const r of reports) if (r.kind === 'customers' && r.rows) r.why = 'Ces clients n’ont aucun rendez-vous : non repris (règle de conservation). Dépose aussi le fichier des réservations.';
  samples.forEach((v, k) => { if (reports[k]) reports[k].sample = v; });
  return { bookings, clients, giftcards, packs, files: reports, problems, windows, unreadable };
}

/* ---------------- matching names to the Comptoir ---------------- */

const STOP = new Set(['formule', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'avec', 'au', 'aux', 'en', 'pour', 'a', 'the', 'and', 'with']);
/** 'Formule Coupe + Contour Barbe 25€' → ['coupe', 'contour', 'barbe'] */
export function words(name: string): string[] {
  return fold(name).replace(/\d+([.,]\d+)?\s*(€|eur(os?)?)?/g, ' ').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
}
function score(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const common = new Set(a.filter((w) => B.has(w))).size;
  return common / Math.max(new Set(a).size, B.size);
}
/** The best match among the candidates (name, short name, slug…), only when it is clearly the best. */
export function bestMatch<T extends { id: string }>(name: string, list: T[], keys: (x: T) => string[]): string {
  const w = words(name);
  let best = '', top = 0, second = 0;
  for (const x of list) {
    const s = Math.max(...keys(x).filter(Boolean).map((k) => (fold(k) === fold(name) ? 1.01 : score(w, words(k)))), 0);
    if (s > top) { second = top; top = s; best = x.id; } else if (s > second) second = s;
  }
  return top >= 0.5 && top > second ? best : '';
}

/** The maps' own keys only: a service called « constructor » must not find Object.prototype's. */
const own = (o: Record<string, string>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : '');
export const svcOf = (map: Mapping, name: string) => own(map.services, name);
export const staffOf = (map: Mapping, name: string) => own(map.staff, name);

const flat = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');
/** Levenshtein distance, giving up above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/**
 * The chair or service a name almost matches: the same letters without spaces or punctuation (« J Kut » → JKut), the start of the
 * other (« larchi » → L’Architecte), or a typo or two (« Steban » → Esteban). Only when one candidate is clearly the closest; '' otherwise
 * and the owner picks (a name far from every chair, John or JBlades, is a barber who left).
 */
export function closeMatch<T extends { id: string }>(name: string, list: T[], keys: (x: T) => string[]): string {
  const q = flat(name);
  if (q.length < 3) return '';
  let best = '', top = 99, tie = false;
  for (const x of list) {
    let d = 99;
    for (const k of keys(x).filter(Boolean)) {
      const f = flat(k);
      if (!f) continue;
      const lim = Math.min(2, Math.floor(Math.min(q.length, f.length) / 4));
      const dist = f === q ? 0 : (q.length >= 4 && f.startsWith(q)) || (f.length >= 4 && q.startsWith(f)) ? 0.5 : distance(q, f, lim);
      if (dist <= (f === q ? 0 : Math.max(lim, 0.5)) && dist < d) d = dist;
    }
    if (d < top) { top = d; best = x.id; tie = false; } else if (d === top && d < 99) tie = true;
  }
  return top < 99 && !tie ? best : '';
}

/* ---------------- what the import will do ---------------- */

/** Has this booking happened (its end is past)? */
export const isPast = (b: { day: string; start: number; dur?: number }, now: number, dur = 30) => dates.instantOf(b.day, b.start + (b.dur || dur)) <= now;

/** Same mapping as the server (commands/import.js mapStatus): the preview's counts. */
export function outcome(b: WpBooking, now: number, dur?: number): 'done' | 'no_show' | 'cancelled' | 'booked' | null {
  if (b.status === 'error') return null;
  if (b.status === 'canceled') return 'cancelled';
  if (!isPast(b, now, dur)) return 'booked';
  if (b.noShow) return 'no_show';
  if (b.status === 'pendingpayment') return null;
  return 'done';
}

/** Rows to send, cut so each request stays well under the server's 64 KB limit (in UTF-8 bytes, as it counts). */
export function chunks<T>(rows: T[], max = 150, bytes = 48000): T[][] {
  const out: T[][] = [];
  const enc = new TextEncoder();
  let cur: T[] = [], size = 0;
  for (const r of rows) {
    const n = enc.encode(JSON.stringify(r)).length + 1;
    if (cur.length && (cur.length >= max || size + n > bytes)) { out.push(cur); cur = []; size = 0; }
    cur.push(r); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ---------------- the preview, and the rows sent to the server ---------------- */

export type Mapping = { services: Record<string, string>; staff: Record<string, string> };
export const LEGACY = 'legacy';
export type ReviewRow = { wp?: number; day?: string; start?: number; name: string; text: string; kind?: string };
export type Identity = { phone?: string; prefix?: string; email?: string; wpUser?: number };
/** Where a booking an earlier run brought in stands now (POST /api/v1/import/preview). */
export type Prior = {
  wp: number; day: string; start: number; dur: number; staffId: string; status: string; open: boolean; movedHere: boolean;
  /** this import cancelled it (annulé or supprimé sur l’ancien site): it comes back if the old site confirms it again */ cancelledByImport?: boolean;
  /** what the old site said last time: the price (cents), the deposit paid (cents), the services (their ids, sorted, joined by a comma) */ price?: number; paid?: number; svc?: string;
  /** still in the agenda and not paid at the till: a deposit paid on the old site since can still be taken */ live?: boolean
};
type Has = { has(wp: number): boolean };

const cut = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) : undefined) || undefined;
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** '2026-10-27' → '27 octobre' (with the year when it is not this one) */
const frDay = (day: string, today: string) => { const d = dates.dayParts(day) as { y: number; m: number; d: number }; return d.d + (d.d === 1 ? 'er ' : ' ') + MONTHS_FR[d.m - 1] + (day.slice(0, 4) === today.slice(0, 4) ? '' : ' ' + d.y); };
const nameOf = (x: { first?: string; last?: string }) => [x.first, x.last].filter(Boolean).join(' ') || 'Sans nom';

/** People across every file: the same number or the same e-mail is the same person (as the server links them). */
export function people(p: Parsed) {
  const byKey = new Map<string, number>();
  const ids: Identity[][] = [];
  /** per group, the number and the first name of the row that made it: two people on one e-mail are told apart as the server does */
  const first: { phone: string; first: string }[] = [];
  const differs = (a?: string, b?: string) => { const x = flat(a || ''), y = flat(b || ''); return !!x && !!y && !x.startsWith(y) && !y.startsWith(x); };
  const add = (x: { phone: string; prefix?: string; email: string; wpUser?: number; first?: string }) => {
    // cut exactly as the rows sent are (toRows): the server sees the same cells, so the same people
    const rawPhone = cut(x.phone, 32), prefix = cut(x.prefix, 6), mail = (cut(x.email, 160) || '').toLowerCase();
    const phone = rawPhone ? normPhoneImport(rawPhone, prefix) : null;
    const email = mail && isEmail(mail) ? mail : '';
    const keys = [x.wpUser ? 'w:' + x.wpUser : '', phone ? 'p:' + phone : '', email ? 'e:' + email : ''].filter(Boolean);
    if (!keys.length) return -1;
    let g = keys.map((k) => byKey.get(k)).find((v) => v != null);
    // only the e-mail leads to that group, whose number is another and whose first name is another: not the same person
    const apart = g != null && !!email && !!phone && !byKey.has('p:' + phone) && !(x.wpUser && byKey.has('w:' + x.wpUser)) && !!first[g].phone && first[g].phone !== phone && differs(x.first, first[g].first);
    if (apart) g = undefined;
    if (g == null) { g = ids.length; ids.push([]); first.push({ phone: phone || '', first: x.first || '' }); }
    // the e-mail stays on the first person
    for (const k of apart ? keys.filter((k) => !k.startsWith('e:')) : keys) byKey.set(k, g);
    ids[g].push({ ...(phone ? { phone: rawPhone, prefix } : {}), ...(email && !apart ? { email } : {}), ...(x.wpUser ? { wpUser: x.wpUser } : {}) });
    return g;
  };
  return { add, ids };
}

/** How many people a set of first names makes: Karim and Karym are one, Mourad and Ilyes two. */
function distinctFirsts(names: Set<string>): number {
  const reps: string[] = [];
  for (const n of [...names].sort()) if (!reps.some((r) => n.startsWith(r) || r.startsWith(n) || distance(n, r, 1) <= 1)) reps.push(n);
  return reps.length;
}
/**
 * The contacts that name too many people to name anyone: a number or an e-mail carried by four different first names
 * (0600000000, noemail@noemail.com, the front desk's dummy address) is a placeholder, never a link between people.
 */
export function sharedContacts(p: Parsed): Set<string> {
  const by = new Map<string, Set<string>>();
  const see = (x: { first: string; phone: string; prefix?: string; email: string }) => {
    const f = flat(x.first || '');
    if (!f) return;
    const phone = x.phone ? normPhoneImport(cut(x.phone, 32) || '', cut(x.prefix, 6)) : null;
    const mail = (x.email || '').toLowerCase();
    for (const k of [phone ? 'p:' + phone : '', mail && isEmail(mail) ? 'e:' + mail : ''].filter(Boolean)) by.set(k, (by.get(k) || new Set<string>()).add(f));
  };
  p.bookings.forEach(see);
  p.clients.forEach(see);
  return new Set([...by].filter(([, v]) => distinctFirsts(v) >= 4).map(([k]) => k));
}
const effects = new WeakMap<Parsed, { bookings: WpBooking[]; clients: WpClient[]; shared: Set<string> }>();
/** The bookings and customers as they are matched and sent: a shared contact is taken off the row (the booking keeps its name). */
function effective(p: Parsed) {
  let e = effects.get(p);
  if (!e) {
    const shared = sharedContacts(p);
    const strip = <T extends { phone: string; prefix?: string; email: string }>(x: T): T => {
      if (!shared.size) return x;
      const phone = x.phone ? normPhoneImport(cut(x.phone, 32) || '', cut(x.prefix, 6)) : null;
      const mail = (x.email || '').toLowerCase();
      const dropP = !!phone && shared.has('p:' + phone), dropE = !!mail && shared.has('e:' + mail);
      return dropP || dropE ? { ...x, ...(dropP ? { phone: '' } : {}), ...(dropE ? { email: '' } : {}) } : x;
    };
    e = { bookings: p.bookings.map(strip), clients: p.clients.map(strip), shared };
    effects.set(p, e);
  }
  return e;
}

const mapped = (b: WpBooking, map: Mapping) => b.services.length > 0 && b.services.every((n) => !!svcOf(map, n));

/**
 * What a re-run does to a booking an earlier run brought in: the same rules as the server's delta()
 * (commands/import.js). Nothing once it was handled here (checked in, paid, moved in the agenda).
 */
export function change(b: WpBooking, k: Prior, staffId: string, now: number, today: string, chairs?: Set<string>, map?: Mapping): 'cancel' | 'move' | 'close' | 'reopen' | 'update' | null {
  // cancelled here by an earlier run, confirmed again and still to come on the old site: back in the agenda (a new booking, the cancelled one stays in the history)
  if (k.cancelledByImport) return b.status !== 'error' && outcome(b, now, k.dur) === 'booked' ? 'reopen' : null;
  const out = outcome(b, now, k.dur);
  // handled here: nothing changes, but a deposit paid on the old site since is still taken (the till can cash it)
  if (!k.open) return out === 'booked' && edits(b, k, map).includes('acompte') ? 'update' : null;
  if (out === 'cancelled') return 'cancel';
  if (out === 'done' || out === 'no_show') return k.day < today ? 'close' : null;
  if (out !== 'booked') return null;
  const sid = staffId && staffId !== LEGACY && (!chairs || chairs.has(staffId)) ? staffId : k.staffId;
  if ((b.day !== k.day || b.start !== k.start || sid !== k.staffId) && !k.movedHere) return 'move';
  return edits(b, k, map).length ? 'update' : null;
}

/**
 * What the old site changed on a booking an earlier run brought in, besides its slot and state (the server's carry()): the deposit paid since,
 * and, while nobody moved it here, the price and the services. Said in words, for the preview's line.
 */
export function edits(b: WpBooking, k: Prior, map?: Mapping): string[] {
  const out: string[] = [];
  if (b.paid && b.paid > (k.paid || 0) && k.live !== false) out.push('acompte');
  if (!k.open || k.movedHere) return out;
  const ids = map && b.services.length ? b.services.map((n) => svcOf(map, n)) : [];
  if (ids.length && ids.every((id) => id && id !== LEGACY) && k.svc != null && [...new Set(ids)].sort().join(',') !== k.svc) out.push('prestation');
  if (b.price != null && k.price != null && b.price !== k.price) out.push('prix');
  return out;
}

/**
 * The barbers' names with upcoming bookings to bring in: they need an active chair here, because the archived
 * 'Ancien barbier' has no lane in the agenda. With a mapping, only the rows that will be sent (services matched).
 */
export function upcomingNames(p: Parsed, now: number, o: { imported?: Has; map?: Mapping } = {}): Set<string> {
  const out = new Set<string>();
  for (const b of p.bookings) if (!o.imported?.has(b.wp) && outcome(b, now) === 'booked' && (!o.map || mapped(b, o.map))) out.add(b.staff);
  return out;
}

type Named = { id: string; name: string; short?: string; slug?: string | null };
/**
 * The choice proposed for each old service name, the owner's earlier choices (`kept`) untouched: the clear match, else a near spelling
 * (said: `guessed`), else « Autre prestation » (the archived Ancienne prestation) when the name only has history, else nothing, so
 * « Ne pas reprendre » and a visible line for its upcoming bookings.
 */
export function suggestServices(p: Parsed, services: Named[], now: number, kept: Record<string, string> = {}, imported?: Has) {
  const ahead = upcomingServices(p, now, { imported });
  const map: Record<string, string> = {}, guessed: string[] = [];
  const keys = (x: Named) => [x.name, x.short || '', x.slug || ''];
  for (const [name] of names(p).services) {
    if (Object.prototype.hasOwnProperty.call(kept, name)) { map[name] = kept[name]; continue; }
    const exact = bestMatch(name, services, keys);
    const close = exact ? '' : closeMatch(name, services, keys);
    if (close) guessed.push(name);
    map[name] = exact || close || (ahead.has(name) ? '' : LEGACY);
  }
  return { map, guessed };
}
/** The same for the barbers: a chair by name, or a near spelling (« J Kut »), else the archived « Ancien barbier » when the name only has history, else the owner picks. */
export function suggestStaff(p: Parsed, chairs: Named[], now: number, kept: Record<string, string> = {}, imported?: Has) {
  const ahead = upcomingNames(p, now, { imported });
  const map: Record<string, string> = {}, guessed: string[] = [];
  for (const [name] of names(p).staff) {
    if (Object.prototype.hasOwnProperty.call(kept, name)) { map[name] = kept[name]; continue; }
    const exact = bestMatch(name, chairs, (x) => [x.name]);
    const close = exact ? '' : closeMatch(name, chairs, (x) => [x.name]);
    if (close) guessed.push(name);
    map[name] = exact || close || (ahead.has(name) ? '' : LEGACY);
  }
  return { map, guessed };
}

/** The services with an upcoming booking to bring in: one left unmatched would lose that booking, so it is not defaulted to the archived « Ancienne prestation ». */
export function upcomingServices(p: Parsed, now: number, o: { imported?: Has } = {}): Set<string> {
  const out = new Set<string>();
  for (const b of p.bookings) if (!o.imported?.has(b.wp) && outcome(b, now) === 'booked') for (const n of b.services) out.add(n);
  return out;
}

/** The chair each WordPress barber's bookings went to in an earlier run, the most used one. */
export function priorStaff(p: Parsed, prior: Map<number, Prior>): Record<string, string> {
  const n = new Map<string, Map<string, number>>();
  for (const b of p.bookings) {
    const k = prior.get(b.wp);
    if (!k) continue;
    const m = n.get(b.staff) || new Map<string, number>();
    m.set(k.staffId, (m.get(k.staffId) || 0) + 1);
    n.set(b.staff, m);
  }
  return Object.fromEntries([...n].map(([name, m]) => [name, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
}

/** The first day still kept: older bookings and customers are not brought in (shared/retention.js). */
export const cutoff = (today: string): string => retentionCutoff(today);

/** An imported booking still to come inside a period the files cover (POST /api/v1/import/preview, `window`). */
export type InWindow = { wp: number; day: string; start: number; staffId: string; status: string; open: boolean };
/** An active booking of the agenda (`busy`): the double-booking check reads it as the batch does. */
export type Busy = { day: string; staffId: string; start: number; dur: number };
export type PreviewOpts = {
  known?: Set<number>; again?: Set<number>; erased?: Map<number, number>; imported?: Map<number, Prior>; chairs?: Set<string>; today?: string;
  inWindow?: InWindow[]; busy?: Busy[]; svcDur?: Record<string, { dur: number; buffer?: number }>;
  /** the cards and carnets of the files (by index) the salon already has: a second drop is no work */
  haveCards?: Set<number>; haveCarnets?: Set<number>;
};

/**
 * Who the import leaves out for retention: files are kept 3 years from the last contact (shared/retention.js), so a
 * person whose newest booking (any state, upcoming included) is before the cutoff is not brought in, nor a customer with no
 * booking at all. Not for a person who already has a file, who is being erased anyway, or who has a running subscription.
 * The same decision serves the preview and the rows sent.
 */
function plan(p: Parsed, o: { known?: Set<number>; again?: Set<number>; erased?: Map<number, number>; today: string; map?: Mapping; now?: number; chairs?: Set<string> }) {
  const P = people(p);
  const cutoff: string = retentionCutoff(o.today);
  const q = effective(p);
  const g = q.bookings.map((b) => P.add(b));
  const cg = q.clients.map((c) => P.add(c));
  const packed = new Set(p.packs.map((k) => P.add({ ...k, email: '' })).filter((x) => x >= 0));
  /** a row counts toward its person's last contact only if it will make a booking (the server decides the same way, batch by batch) */
  const will = (b: WpBooking) => {
    if (!o.map || o.now == null) return true;
    const out = outcome(b, o.now);
    if (out === null || !mapped(b, o.map)) return false;
    if (out !== 'booked') return true;
    if (b.services.some((n) => svcOf(o.map!, n) === LEGACY)) return false;
    const sid = staffOf(o.map, b.staff);
    return !!sid && sid !== LEGACY && (!o.chairs || o.chairs.has(sid));
  };
  const newest = new Map<number, string>();
  p.bookings.forEach((b, i) => { if (g[i] >= 0 && will(b) && !((newest.get(g[i]) || '') >= b.day)) newest.set(g[i], b.day); });
  const out = new Map<number, 'retention' | 'noVisit'>();
  for (let x = 0; x < P.ids.length; x++) {
    if (o.known?.has(x) || o.again?.has(x) || o.erased?.has(x) || packed.has(x)) continue;
    const n = newest.get(x);
    if (n === undefined) out.set(x, 'noVisit');
    else if (n < cutoff) out.set(x, 'retention');
  }
  /**
   * A row nobody can keep: older than the cutoff, and its person is out (or it names nobody). A recent row of a person who is out is a row
   * the server will skip for its own reason (an error, a service left unmatched): it is sent, so the report says which.
   */
  const left = (b: WpBooking, i: number) => b.day < cutoff && (g[i] >= 0 ? out.has(g[i]) : true);
  return { P, g, cg, out, cutoff, left };
}

/**
 * What the owner should know before sending, that the counts do not say: an export that stops before the bookings to come, two periods
 * with a hole between them, a cut file, numbers without their country code, cards without an expiry, dates written in digits only,
 * contacts shared by many people. Each is one sentence; none blocks the import.
 */
function notesOf(p: Parsed, today: string, shared: number): string[] {
  const notes: string[] = [];
  const books = p.files.filter((f) => f.kind === 'bookings' || f.kind === 'wxr');
  if (p.bookings.length && !p.bookings.some((b) => b.day >= today)) notes.push('Aucun rendez-vous à venir dans ces fichiers. Dans l’export, le champ « à » propose la date du jour : change-le pour une date dans un an, puis refais l’export.');
  const wins = [...new Map(p.windows.map((w) => [w.from + w.to, w])).values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  if (wins.length) {
    const end = wins.reduce((m, w) => (w.to > m ? w.to : m), '');
    if (end < dates.addDays(today, 60)) notes.push('Ton export s’arrête le ' + frDay(end, today) + ' : les rendez-vous après cette date ne sont pas dedans. Refais-le avec une date de fin dans un an.');
    let reach = wins[0].to;
    for (const w of wins.slice(1)) {
      if (w.from > dates.addDays(reach, 1)) notes.push('Aucun fichier ne couvre la période du ' + frDay(dates.addDays(reach, 1), today) + ' au ' + frDay(dates.addDays(w.from, -1), today) + ' : des rendez-vous manquent peut-être.');
      if (w.to > reach) reach = w.to;
    }
  }
  for (const f of books) if (f.cut) notes.push('« ' + f.name + ' » est coupé : le fichier s’arrête avant sa fin (hébergement trop lent ?). Refais l’export.');
  if (p.files.some((f) => f.kind === 'bookings' && f.rows > 0) && !p.files.some((f) => f.kind === 'wxr') && p.bookings.some((b) => b.phone)) notes.push('Le CSV ne contient pas l’indicatif pays : un numéro étranger est lu comme français. Ajoute l’export XML (Tout le contenu) ou vérifie les numéros qui ne commencent pas par 06 ou 07.');
  for (const f of p.files) if (f.order === 'unsure') notes.push('Les dates de « ' + f.name + ' » sont écrites en chiffres seulement : vérifie le jour et le mois dans l’exemple ci-dessus.');
  else if (f.order === 'mixed') notes.push('« ' + f.name + ' » mélange les dates jour/mois et mois/jour : vérifie l’exemple ci-dessus et les lignes illisibles.');
  const open = p.giftcards.filter((g) => !g.expires).length;
  if (open) notes.push(open + (open > 1 ? ' cartes cadeaux n’ont' : ' carte cadeau n’a') + ' pas de date d’expiration : ' + (open > 1 ? 'elles seront valables' : 'elle sera valable') + ' un an à partir d’aujourd’hui.');
  const codes = new Set<string>();
  let again = 0;
  for (const g of p.giftcards) { const c = g.code.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (codes.has(c)) again++; codes.add(c); }
  if (again) notes.push(again + (again > 1 ? ' codes de carte apparaissent' : ' code de carte apparaît') + ' deux fois dans les fichiers : une seule carte est créée.');
  if (shared) notes.push(shared + (shared > 1 ? ' numéros ou e-mails sont partagés' : ' numéro ou e-mail est partagé') + ' par au moins quatre personnes différentes (un contact factice ?) : ' + (shared > 1 ? 'ils ne servent' : 'il ne sert') + ' pas à relier les fiches.');
  return notes;
}

/**
 * What the import would do, before anything is sent: only the rows that will be sent are counted. `known` holds the
 * groups that already have a file of the salon, `again` those an earlier run created (POST /api/v1/import/preview),
 * `erased` those whose file was erased, and when (the server skips their rows from before), `imported` the bookings
 * an earlier run brought in and where they stand now, `chairs` the active chairs, `busy` the agenda's bookings on the
 * days to come (double bookings are checked against them too), `inWindow` the imported bookings still to come inside the
 * periods the files cover (what the export no longer lists was deleted on the old site).
 */
export function preview(p: Parsed, map: Mapping, now: number, o: PreviewOpts = {}) {
  const known = o.known || new Set<number>(), again = o.again || new Set<number>(), imported = o.imported || new Map<number, Prior>();
  const erased = o.erased || new Map<number, number>(), told = new Set<number>();
  const today = o.today || dates.localParts(now).day;
  const { P, g, cg, out: left, left: isLeft } = plan(p, { known, again, erased, today, map, now, chairs: o.chairs });
  const eff = effective(p);
  const groups = new Set<number>();
  const counts = { newClients: 0, merged: 0, past: 0, noShow: 0, upcoming: 0, cancelled: 0, skipped: 0, unmapped: 0, already: 0, toCancel: 0, toMove: 0, toClose: 0, toReopen: 0, toUpdate: 0, erased: 0, giftcards: p.giftcards.filter((_, i) => !o.haveCards?.has(i)).length, packs: p.packs.filter((_, i) => !o.haveCarnets?.has(i)).length };
  const review: ReviewRow[] = [];
  /** the chairs' bookings per day: the agenda's first, then this run's own */
  const lanes = new Map<string, { start: number; dur: number }[]>();
  for (const x of o.busy || []) { const k = x.day + '|' + x.staffId; lanes.set(k, [...(lanes.get(k) || []), { start: x.start, dur: x.dur }]); }
  /** the server's length: the file's own, else the services' (with the longest buffer) */
  const durOf = (b: WpBooking) => {
    if (b.dur) return b.dur;
    const sv = [...new Set(b.services.map((n) => svcOf(map, n)).filter(Boolean))].map((id) => o.svcDur?.[id]).filter(Boolean) as { dur: number; buffer?: number }[];
    return sv.length ? sv.reduce((t, x) => t + x.dur, 0) + Math.max(0, ...sv.map((x) => x.buffer || 0)) : 30;
  };
  let retentionRows = 0;
  p.bookings.forEach((b, i) => {
    const gi = g[i];
    const row = { wp: b.wp, day: b.day, start: b.start, name: nameOf(b) };
    // cancelled here by an earlier run and confirmed again on the old site: counted as a booking to put back, through the normal path
    const k0 = imported.get(b.wp);
    const reopen = !!k0 && b.status !== 'error' && change(b, k0, staffOf(map, b.staff), now, today, o.chairs, map) === 'reopen';
    const k = reopen ? undefined : k0;
    // retention: not brought in, as the rows sent leave it out (an earlier run's booking is carried over whatever its age)
    if (!k0 && isLeft(b, i)) { retentionRows++; return; }
    // erased at their request or after 3 years: left out, as the server does, unless booked on the old site since
    const gone = gi >= 0 ? erased.get(gi) : undefined;
    if (gone !== undefined && !(b.createdAt && b.createdAt > gone)) {
      counts.erased++;
      if (!told.has(gi)) { told.add(gi); review.push({ wp: b.wp, day: b.day, start: b.start, name: '', kind: 'erased', text: 'Client effacé : ses lignes sont ignorées' }); }
      return;
    }
    if (k) {
      const ch = b.status === 'error' ? null : change(b, k, staffOf(map, b.staff), now, today, o.chairs, map);
      // « Erreur » since it came in: kept here, and said (the server lists it as « À faire »)
      if (b.status === 'error' && k.live !== false) review.push({ ...row, kind: 'error', text: 'État « Erreur » sur l’ancien site depuis le premier import : rendez-vous gardé ici, vérifie avec le client' });
      // a deposit paid there: the client may be owed it back
      if (ch === 'cancel') { counts.toCancel++; review.push({ ...row, kind: 'cancel', text: 'Annulé sur l’ancien site depuis le premier import : sera annulé ici' + ((k.paid || 0) || b.paid ? '. Un acompte y était payé : rembourse-le si besoin, depuis l’ancien site' : '') }); }
      else if (ch === 'move') { counts.toMove++; review.push({ ...row, kind: 'move', text: 'Déplacé sur l’ancien site depuis le premier import : sera déplacé ici' }); }
      else if (ch === 'close') counts.toClose++;
      else if (ch === 'update') { counts.toUpdate++; review.push({ ...row, kind: 'update', text: 'Modifié sur l’ancien site depuis le premier import (' + edits(b, k, map).join(', ') + ') : sera mis à jour ici' }); }
      else counts.already++;
      return;
    }
    const out = outcome(b, now);
    if (!out) { counts.skipped++; return; }
    // an upcoming booking cannot sit on « Ancienne prestation »: it would be in the agenda as a service nobody sells
    const viaLegacy = out === 'booked' && b.services.some((n) => svcOf(map, n) === LEGACY);
    if (!mapped(b, map) || viaLegacy) {
      counts.unmapped++;
      const lost = b.services.filter((n) => !svcOf(map, n) || (viaLegacy && svcOf(map, n) === LEGACY)).join(', ') || 'aucune';
      review.push({ ...row, kind: 'service', text: 'Prestation inconnue : ' + lost + (out === 'booked' ? ' : ce rendez-vous à venir n’est pas dans l’agenda, ajoute-le à la main' : ' (ligne ignorée)') });
      return;
    }
    if (gi >= 0) groups.add(gi);
    const e = eff.bookings[i];
    if (e.phone && !normPhoneImport(e.phone, e.prefix)) review.push({ ...row, kind: 'phone', text: 'Numéro illisible : « ' + e.phone.slice(0, 40) + ' »' });
    if (e.email && !isEmail(e.email)) review.push({ ...row, kind: 'email', text: 'E-mail illisible : « ' + e.email.slice(0, 60) + ' » : pas gardé' });
    if (!e.phone && !e.email) review.push({ ...row, kind: 'phone', text: b.phone || b.email ? 'Numéro ou e-mail partagé par plusieurs personnes : rendez-vous sans fiche client' : 'Ni numéro ni e-mail : rendez-vous sans fiche client' });
    if (out === 'done') counts.past++;
    else if (out === 'no_show') counts.noShow++;
    else if (out === 'cancelled') counts.cancelled++;
    else {
      if (reopen) { counts.toReopen++; review.push({ ...row, kind: 'reopened', text: 'Rétabli sur l’ancien site : remis dans l’agenda, vérifie le créneau' }); } else counts.upcoming++;
      const staffId = staffOf(map, b.staff);
      if (!staffId || staffId === LEGACY || (o.chairs && !o.chairs.has(staffId))) { review.push({ ...row, kind: 'staff', text: 'À venir : choisis un barbier actif pour « ' + (b.staff || 'Sans barbier') + ' »' }); return; }
      const lane = b.day + '|' + staffId, dur = durOf(b);
      const list = lanes.get(lane) || [];
      if (list.some((x) => x.start < b.start + dur && b.start < x.start + x.dur)) review.push({ ...row, kind: 'overlap', text: 'Chevauche un autre rendez-vous' });
      lanes.set(lane, [...list, { start: b.start, dur }]);
    }
  });
  eff.clients.forEach((c, i) => { const x = cg[i]; if (x >= 0 && !erased.has(x) && !left.has(x)) groups.add(x); });
  // a file an earlier run created is neither new nor merged (the server counts it as neither)
  for (const x of groups) if (!again.has(x)) counts[known.has(x) ? 'merged' : 'newClients']++;

  // deleted on the old site: still to come inside a period an export covers, and in none of the files. Those nobody
  // handled here are cancelled; the server tells the others apart and lists them for a look
  const inFiles = new Set([...p.bookings.map((b) => b.wp), ...p.unreadable]);
  // the guard counts the ones that would be cancelled (open: nobody handled them here); the others are sent too, the server lists them for a look
  const live = [...new Map((o.inWindow || []).filter((x) => ['booked', 'pending', 'arrived', 'in_chair'].includes(x.status)).map((x) => [x.wp, x])).values()];
  const openLive = live.filter((x) => x.open).length;
  let gone = live.filter((x) => !inFiles.has(x.wp));
  let warning = '';
  // an export that stops short would cancel half the agenda: past a few, nothing is sent
  const goneOpen = gone.filter((x) => x.open).length;
  if (goneOpen > Math.max(5, openLive * 0.2)) { warning = goneOpen + ' rendez-vous à venir ont disparu de l’export : vérifie qu’il couvre toute la période. Rien n’est annulé.'; gone = []; }
  for (const x of gone) review.push({ wp: x.wp, day: x.day, start: x.start, name: '', kind: 'gone', text: x.open ? 'Supprimé sur l’ancien site : sera annulé ici, sans SMS' : 'Supprimé sur l’ancien site, mais déjà pris en charge ici : vérifie' });

  // what the files held, and what is left out before sending, so the run's report can add up
  const rep = (kinds: FileKind[]) => p.files.filter((f) => kinds.includes(f.kind));
  const sum = (list: FileReport[], k: 'rows' | 'dupes' | 'bad') => list.reduce((t, f) => t + (f[k] || 0), 0);
  const bk = rep(['bookings', 'wxr']);
  const raw = sum(bk, 'rows') + sum(bk, 'dupes') + sum(bk, 'bad');
  const duplicate = sum(bk, 'rows') + sum(bk, 'dupes') - p.bookings.length;
  const bad = { bookings: sum(bk, 'bad'), giftcards: sum(rep(['giftcards']), 'bad'), packs: sum(rep(['packs']), 'bad') };
  const people_ = { retention: 0, noVisit: 0 };
  for (const v of left.values()) people_[v]++;
  // people the server will not bring back (their file was erased): neither made nor already there, but not lost
  const skippedPeople = [...erased.keys()].filter((x) => !groups.has(x)).length;
  const totals = { bookings: raw, clients: P.ids.length, giftcards: p.giftcards.length + bad.giftcards, packs: p.packs.length + bad.packs };
  const excluded = {
    retention: people_.retention, noVisit: people_.noVisit, duplicate, unreadable: bad.bookings + bad.giftcards + bad.packs,
    by: { bookings: duplicate + bad.bookings + retentionRows, clients: people_.retention + people_.noVisit, giftcards: bad.giftcards, packs: bad.packs }
  };
  return { counts, review, identities: P.ids, gone: gone.map((x) => x.wp), goneOpen: gone.filter((x) => x.open).length, warning, notes: notesOf(p, today, eff.shared.size), totals, excluded, skippedPeople };
}

/** A value the server would refuse (and with it the whole batch) is left out instead: a 12-hour WXR duration. */
const within = (v: number | null | undefined, min: number, max: number) => (v != null && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/**
 * The rows for POST /api/v1/import/batch (cut into requests by `chunks`). Bookings an earlier run brought in are
 * sent again, even with a service left unmatched: the server carries over what changed since (cancelled, moved).
 * Rows it will skip anyway (an error, a service left unmatched) are sent too, so the server counts them by reason.
 * With `today`, the people the retention rule leaves out are not sent at all; the older bookings of those who stay go
 * after the others (the server brings an old row in when its person has a visit since, here or in an earlier batch).
 * `gone`: the bookings the preview found deleted on the old site.
 */
export function toRows(p: Parsed, map: Mapping, imported: Has = new Set<number>(), o: { today?: string; known?: Set<number>; again?: Set<number>; erased?: Map<number, number>; gone?: number[]; now?: number; chairs?: Set<string> } = {}) {
  const pl = o.today ? plan(p, { known: o.known, again: o.again, erased: o.erased, today: o.today, map, now: o.now, chairs: o.chairs }) : null;
  const q = effective(p);
  const recent: Record<string, unknown>[] = [], old: Record<string, unknown>[] = [];
  p.bookings.forEach((_, i) => {
    // a contact shared by several people is not sent: the booking keeps its name
    const b = q.bookings[i];
    const again = imported.has(b.wp);
    if (!again && pl && pl.left(b, i)) return;
    // the names the server may need to say which service a skipped booking had: the unmatched ones, and the ones sent to « Ancienne prestation » (an upcoming booking there is left out)
    const wps = (mapped(b, map) ? b.services.filter((n) => svcOf(map, n) === LEGACY) : b.services.filter((n) => !svcOf(map, n))).map((n) => n.slice(0, 80)).slice(0, 6);
    (pl && b.day < pl.cutoff ? old : recent).push({
      wp: b.wp, uniq: b.uniq, day: b.day, start: b.start, dur: within(b.dur, 5, 600), createdAt: o.now != null && b.createdAt && b.createdAt > o.now + 86400000 ? undefined : b.createdAt,
      first: cut(b.first, 60), last: cut(b.last, 60), phone: cut(b.phone, 32), prefix: cut(b.prefix, 6), email: cut(b.email, 160), wpUser: b.wpUser,
      serviceIds: mapped(b, map) ? [...new Set(b.services.map((n) => svcOf(map, n)))].slice(0, 6) : [], staffId: staffOf(map, b.staff) || LEGACY,
      price: within(b.price, 0, 1000000), paid: within(b.paid, 1, 1000000), status: b.status, noShow: b.noShow || undefined, note: cut(b.note, 300),
      // the old site's name for a service left unmatched, so the report says which one the skipped row was
      wpServices: wps.length ? wps : undefined
    });
  });
  const appts = [...recent, ...old];
  const clients = q.clients.filter((c, i) => !(pl && pl.cg[i] >= 0 && pl.out.has(pl.cg[i]))).map((c) => ({ first: cut(c.first, 60), last: cut(c.last, 60), phone: cut(c.phone, 32), email: cut(c.email, 160), notes: cut(c.notes, 1000), wpUser: c.wpUser }));
  const giftcards = p.giftcards.map((g) => ({ code: g.code.slice(0, 40), amount: g.amount, expires: g.expires }));
  const packs = p.packs.map((k) => ({ phone: cut(k.phone, 32), first: cut(k.first, 60), last: cut(k.last, 60), left: Math.min(50, k.left), expires: k.expires }));
  return { clients, appts, giftcards, packs, gone: [...new Set(o.gone || [])] };
}

/** The first 16 hex digits of a file's SHA-256: which export a run was made from, without keeping it. */
export async function sha16(text: string): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    // not a secure context: a plain 53-bit hash does the same job here (telling two exports apart)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
}

/** The body of POST /api/v1/import/runs: what the files held and what was left out before sending (see `preview`). */
export function runBody(p: Parsed, pv: ReturnType<typeof preview>, map: Mapping, shas: string[], parts: number) {
  const windows = [...new Map(p.windows.map((w) => [w.from + w.to, w])).values()].slice(0, 12);
  return {
    source: 'files' as const,
    files: p.files.slice(0, 30).map((f, i) => ({ name: f.name.slice(0, 80), kind: f.kind, rows: f.rows, sha: shas[i] || '', ...(f.at ? { at: f.at } : {}), ...(f.newest ? { newest: f.newest } : {}) })),
    window: windows,
    map: {
      services: Object.fromEntries(Object.entries(map.services).filter(([, v]) => v).slice(0, 300).map(([k, v]) => [k.slice(0, 80), v])),
      staff: Object.fromEntries(Object.entries(map.staff).slice(0, 100).map(([k, v]) => [k.slice(0, 80), v || LEGACY]))
    },
    totals: pv.totals, excluded: pv.excluded, skippedPeople: pv.skippedPeople, parts,
    // the lines nobody could read, kept with the run so the report lists them (the cell's bad value, never a name)
    problems: p.problems.slice(0, 500).map((x) => ({ file: x.file.slice(0, 80), line: Math.max(0, Math.min(100000000, x.line)), ...(x.wp ? { wp: x.wp } : {}), text: x.text.slice(0, 160) }))
  };
}

/** WordPress names seen in the bookings, most used first: the services and barbers to map. */
export function names(p: Parsed) {
  const count = (pick: (b: WpBooking) => string[]) => {
    const m = new Map<string, number>();
    for (const b of p.bookings) if (b.status !== 'error') for (const n of pick(b)) m.set(n, (m.get(n) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return { services: count((b) => b.services), staff: count((b) => [b.staff]) };
}

/* ---------------- the report of a run (GET /api/v1/import/runs/:id) ---------------- */

export type RunCounts = { clients?: Record<string, number>; appts?: Record<string, number>; giftcards?: Record<string, number>; packs?: Record<string, number> };
export type RunRecord = {
  id: string; at: number; by: string; source: 'files' | 'site'; batches: number; parts?: number; lastIndex: number; /** when the last batch came in (a run whose last batch is under a minute old is still going) */ lastAt?: number; finishedAt: number | null; undoneAt: number | null;
  files: { name: string; kind: string; rows: number; sha: string; at?: number; newest?: number }[]; window: Period[]; site?: { url: string };
  /** the lines nobody could read, as the browser listed them (file, line, WordPress id, the bad value) */
  problems?: { file: string; line: number; wp?: number; text: string }[];
  totals: { bookings: number; clients: number; giftcards: number; packs: number };
  excluded: { retention: number; noVisit: number; duplicate: number; unreadable: number; by?: Record<string, number> };
  counts: RunCounts; skip: Record<string, number>; skippedPeople?: number;
};
export type ReportLine = { kind: string; wp: number; day: string; start: number | null; name: string; staff: string; text: string; todo: boolean };
/** Why rows are skipped, in the owner's words (the keys of a run's `skip`). */
export const SKIP_WORDS: Record<string, string> = {
  error: 'État « Erreur » sur l’ancien site', unpaid: 'Paiement en ligne jamais terminé', service: 'Prestation inconnue', staff: 'Barbier inconnu ou sans chaise',
  retention: 'Plus de 3 ans sans visite', erased: 'Client effacé', phone: 'Ni numéro ni e-mail', rows: 'Autres lignes ignorées (personnes regroupées autrement ici)', giftcard: 'Carte non reprise', pack: 'Carnet non repris'
};
export type Recon = { type: 'bookings' | 'clients' | 'giftcards' | 'packs'; label: string; source: number; made: number; already: number; skipped: number; reasons: { key: string; n: number }[]; left: number; gap: number; /** a run that stopped: what it had not reached yet */ pending: number };

/**
 * « Rows in the export = rows here + rows skipped »: for each kind of record, what the files held, what was made,
 * what was already there, what was skipped (by reason), what was left out before sending. gap ≠ 0 means something was lost
 * or counted twice. Clients are people: those whose file was erased are counted by the browser
 * (`skippedPeople`); the remainder is shown as its own reason.
 */
export function reconcile(run: Pick<RunRecord, 'totals' | 'excluded' | 'counts' | 'skip' | 'skippedPeople'> & { finishedAt?: number | null }): Recon[] {
  const c = run.counts || {}, a = c.appts || {}, cl = c.clients || {}, gc = c.giftcards || {}, pk = c.packs || {}, k = run.skip || {}, by = run.excluded.by || {};
  const n = (x: number | undefined) => x || 0;
  const bookingsSkipped = n(a.skipped);
  const erasedB = Math.max(0, bookingsSkipped - ['error', 'unpaid', 'service', 'staff', 'retention'].reduce((t, r) => t + n(k[r]), 0));
  const packsErased = Math.max(0, n(pk.skipped) - n(k.pack));
  const rows: Recon[] = [];
  const add = (type: Recon['type'], label: string, source: number, made: number, already: number, skipped: number, reasons: [string, number][], left: number) => {
    const sum = made + already + skipped + left;
    // a run that stopped has not reached everything yet: the rest is « pas encore traités », not a gap
    const pending = run.finishedAt === null ? Math.max(0, source - sum) : 0;
    rows.push({ type, label, source, made, already, skipped, reasons: reasons.filter(([, v]) => v > 0).map(([key, v]) => ({ key, n: v })), left, gap: source - sum - pending, pending });
  };
  add('bookings', 'Réservations', run.totals.bookings, ['done', 'noShow', 'cancelled', 'booked', 'moved', 'closed', 'changed', 'updated'].reduce((t, r) => t + n(a[r]), 0), n(a.already), bookingsSkipped,
    [['error', n(k.error)], ['unpaid', n(k.unpaid)], ['service', n(k.service)], ['staff', n(k.staff)], ['retention', n(k.retention)], ['erased', erasedB]], n(by.bookings));
  const made = n(cl.added), already = n(cl.merged) + n(cl.again), left = n(by.clients), erased = n(run.skippedPeople);
  // people whose file was erased are named; what is left is grouped differently here and there (a person with two numbers) and shown as such, not hidden
  const rest = run.finishedAt === null ? 0 : Math.max(0, run.totals.clients - made - already - left - erased);
  add('clients', 'Clients', run.totals.clients, made, already, erased + rest, [['erased', erased], ['rows', rest]], left);
  add('giftcards', 'Cartes cadeaux', run.totals.giftcards, n(gc.added), n(gc.already), n(gc.skipped), [['giftcard', n(gc.skipped)]], n(by.giftcards));
  add('packs', 'Carnets', run.totals.packs, n(pk.added), n(pk.already), n(pk.skipped), [['pack', n(k.pack)], ['erased', packsErased]], n(by.packs));
  return rows;
}

/** What each kind of line is called in the report's groups (the line itself says the rest). */
const KIND_TITLE: Record<string, string> = {
  pending: 'En attente sur l’ancien site', paid: 'Déjà payé sur l’ancien site', overlap: 'Chevauchements', today: 'Terminés aujourd’hui sur l’ancien site', moved: 'Déplacés',
  cancelled: 'Annulés sur l’ancien site mais déjà pris en charge', service: 'Prestations inconnues', staff: 'Barbiers à choisir', phone: 'Numéros illisibles', erased: 'Clients effacés',
  giftcard: 'Cartes cadeaux non reprises', pack: 'Carnets non repris', error: 'État « Erreur » sur l’ancien site', unpaid: 'Paiement en ligne jamais terminé', retention: 'Plus de 3 ans sans visite',
  gone: 'Supprimés sur l’ancien site', 'gone-handled': 'Supprimés sur l’ancien site mais déjà pris en charge', name: 'Même numéro, autre prénom', 'email-elsewhere': 'E-mail déjà sur une autre fiche',
  'new-number': 'Nouveau numéro sur l’ancien site', 'status-unknown': 'État inconnu sur l’ancien site', reopened: 'Rétablis sur l’ancien site', person: 'Même e-mail, autre personne',
  landline: 'Numéros fixes : pas de SMS', unreadable: 'Lignes illisibles', email: 'E-mails illisibles',
  changed: 'Modifiés sur l’ancien site', refund: 'Acomptes à rembourser (annulés sur l’ancien site)'
};
export const kindTitle = (k: string) => KIND_TITLE[k] || k;

/** A CSV cell Excel will not run as a formula (names come from the old site), quoted when it holds the separator. */
export const csvCell = (v: string | number | null | undefined) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
/** The report as a file for whoever helps: UTF-8 with a BOM, `;` as French Excel wants, the counts first (so the file alone says whether the run adds up), then one line per row to look at. */
export function reportCsv(lines: ReportLine[], rep: Recon[]) {
  const head = ['type', 'raison', 'n° WordPress', 'date', 'heure', 'client', 'barbier', 'détail'];
  const dmy = (d: string) => d.split('-').reverse().join('/');
  const hhmm = (m: number) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const counts = rep.map((r) => ['compte', r.label, '', '', '', '', '', 'source ' + r.source + ' · repris ' + r.made + ' · déjà là ' + r.already + ' · ignorés ' + r.skipped + ' · hors conservation ' + r.left + ' · écart ' + r.gap]);
  const out = lines.map((l) => [l.kind, kindTitle(l.kind), l.wp || '', l.day ? dmy(l.day) : '', l.start != null ? hhmm(l.start) : '', l.name, l.staff, l.text]);
  return '\uFEFF' + [head, ...counts, ...out].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/* ---------------- what to tell the owner when something goes wrong, and the files she can take away ---------------- */

const FIELD_WORDS: Record<string, string> = {
  createdAt: 'date de création illisible', day: 'date illisible', start: 'heure illisible', dur: 'durée illisible', wp: 'numéro illisible', uniq: 'code de lien illisible',
  phone: 'numéro de téléphone illisible', prefix: 'indicatif illisible', email: 'e-mail illisible', first: 'prénom illisible', last: 'nom illisible', serviceIds: 'prestation illisible', staffId: 'barbier illisible',
  price: 'prix illisible', paid: 'acompte illisible', status: 'état illisible', note: 'note illisible', amount: 'montant illisible', code: 'code illisible', expires: 'date d’expiration illisible', left: 'nombre de coupes illisible'
};
/**
 * The sentence for a batch the server refused ('invalid', « appts[3].createdAt : … »): which booking, card or carnet, and what was wrong,
 * never the raw path. Null when the message is not about a row.
 */
export function refusalWords(message: string, body: { appts?: { wp?: number }[]; clients?: unknown[]; giftcards?: { code?: string }[]; packs?: unknown[] }): string | null {
  const m = /^(appts|clients|giftcards|packs)\[(\d+)\](?:\.(\w+))?/.exec(message.trim());
  if (!m) return null;
  const i = +m[2], what = (m[3] && FIELD_WORDS[m[3]]) || 'une valeur est refusée';
  if (m[1] === 'appts') { const wp = body.appts?.[i]?.wp; return (wp ? 'Réservation n° ' + wp : 'Réservation n° ' + (i + 1) + ' du paquet') + ' : ' + what; }
  if (m[1] === 'giftcards') { const c = (body.giftcards?.[i]?.code || '').replace(/[^A-Za-z0-9]/g, '').slice(-4); return 'Carte ' + (c ? '•••• ' + c : 'n° ' + (i + 1)) + ' : ' + what; }
  return (m[1] === 'clients' ? 'Fiche client n° ' : 'Carnet n° ') + (i + 1) + ' du paquet : ' + what;
}

/** The lines the reader could not understand, as a file the owner can hand to whoever helps (UTF-8 with a BOM, `;`). */
export function problemsCsv(list: { file: string; line: number; wp?: number; text: string }[]) {
  const head = ['fichier', 'ligne', 'n° WordPress', 'raison'];
  return '\uFEFF' + [head, ...list.map((x) => [x.file, x.line || '', x.wp || '', x.text])].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** The two small files typed by hand, as a model to fill in: a header and one example line (UTF-8 with a BOM, `;`, as French Excel opens it). */
export const TEMPLATES = {
  giftcards: { name: 'modele-cartes-cadeaux.csv', text: '\uFEFFcode;solde;expire_le\r\nCARTE-0042-AB;50,00;2027-06-30\r\n' },
  packs: { name: 'modele-carnets.csv', text: '\uFEFFtelephone;coupes_restantes;expire_le\r\n06 12 34 56 78;7;2027-03-31\r\n' }
};
