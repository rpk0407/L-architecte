// Reading the old WordPress salon's exports in the browser (Salon Booking System): the bookings CSV of
// Salon › Calendrier, the optional WXR of Outils › Exporter (no-shows, notes, the secret of old e-mail links),
// the plugin's customer CSV, and two small CSVs typed by hand for paper gift cards and running subscriptions.
// Nothing leaves the browser before the owner has seen the preview; the server decides again (commands/import.js).
// Self-contained (plain TypeScript, no other .ts import), so the unit tests run it in Node as is.
// @ts-ignore: plain JS module with JSDoc types
import * as D from '../../../shared/dates.js';
// @ts-ignore: plain JS module with JSDoc types
import * as PH from '../../../shared/phone.js';

const dates = D as { instantOf(day: string, min: number): number; isDay(s: string): boolean; addDays(key: string, n: number): string; localParts(ms: number): { day: string } };

export type WpStatus = 'confirmed' | 'pending' | 'pendingpayment' | 'paid' | 'paylater' | 'canceled' | 'error';
export type WpBooking = {
  wp: number; uniq?: string; day: string; start: number; dur?: number; createdAt?: number;
  first: string; last: string; email: string; phone: string; prefix?: string;
  services: string[]; staff: string; price: number | null; paid: number; status: WpStatus; noShow: boolean; note: string;
};
export type WpClient = { first: string; last: string; email: string; phone: string; prefix?: string; notes: string };
export type WpGift = { code: string; amount: number; expires?: string };
export type WpPack = { phone: string; first: string; last: string; left: number; expires: string };
export type FileKind = 'bookings' | 'wxr' | 'customers' | 'giftcards' | 'packs' | 'unknown';
export type FileReport = { name: string; kind: FileKind; rows: number; dupes?: number };
export type Problem = { file: string; line: number; text: string };
export type Parsed = { bookings: WpBooking[]; clients: WpClient[]; giftcards: WpGift[]; packs: WpPack[]; files: FileReport[]; problems: Problem[] };

/* ---------------- small readers ---------------- */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** RFC 4180, as PHP's fputcsv writes it: quotes doubled, line breaks allowed inside quotes. */
export function parseCsv(text: string, sep?: string): string[][] {
  text = text.replace(/^﻿/, '');
  const d = sep || sniff(text);
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
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

/** "12 Déc 2025 14:30", "12/12/2025 14h30", "2025-12-12 14:30" → { day, min } (shop-local time). */
export function parseWhen(raw: string): { day: string; min: number } | null {
  const s = fold(raw).replace(/ | /g, ' ');
  let y = 0, m = 0, d = 0;
  let rest = '';
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(s);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; rest = x[4]; }
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(.*)$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; rest = x[4]; }
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
const isEmail = (e: string) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(e);

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
/** The first of the first rows whose cells name these columns (the bookings export starts with a 3-row preamble). */
function findHeader(rows: string[][], table: Record<string, string[]>, need: string[]) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
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
  const c = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
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
function readWxr(text: string, problems: Problem[], file: string): WxrBooking[] {
  const items = text.split(/<item>/).slice(1).map((x) => x.split('</item>')[0]);
  const titles = new Map<string, string>();
  for (const it of items) { const type = tag(it, 'wp:post_type'); if (type === 'sln_service' || type === 'sln_attendant') titles.set(tag(it, 'wp:post_id'), tag(it, 'title')); }
  const out: WxrBooking[] = [];
  for (const it of items) {
    if (tag(it, 'wp:post_type') !== 'sln_booking') continue;
    const wp = Number(tag(it, 'wp:post_id'));
    if (!wp) continue;
    const meta = new Map<string, string>();
    for (const m of it.split(/<wp:postmeta>/).slice(1)) meta.set(tag(m, 'wp:meta_key'), tag(m, 'wp:meta_value'));
    const g = (k: string) => (meta.get('_sln_booking_' + k) || '').trim();
    const st = parseStatus(tag(it, 'wp:status'));
    const svc = unserialize(g('services'));
    const lines = svc && typeof svc === 'object' ? Object.values(svc as Record<string, any>).filter((x) => x && typeof x === 'object') : [];
    const services = lines.map((l) => titles.get(String(l.service)) || '').filter(Boolean);
    const att = lines.map((l) => titles.get(String(l.attendant)) || '').find(Boolean) || titles.get(g('attendant')) || '';
    const dur = lines.reduce((t, l) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(l.duration || '')); return t + (m ? +m[1] * 60 + +m[2] : 0); }, 0);
    const time = /^(\d{1,2}):(\d{2})/.exec(g('time'));
    const amount = g('amount') ? Math.round(parseFloat(g('amount')) * 100) : null;
    const deposit = g('deposit') ? Math.round(parseFloat(g('deposit')) * 100) : 0;
    const created = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(tag(it, 'wp:post_date_gmt'));
    const b: WxrBooking = { wp, noShow: g('no_show') === '1' };
    if (/^[A-Za-z0-9]{6,64}$/.test(g('uniqid'))) b.uniq = g('uniqid');
    if (g('sms_prefix')) b.prefix = g('sms_prefix');
    const note = [g('note'), g('admin_note')].filter(Boolean).join(' · ');
    if (note) b.note = note;
    if (dur) b.dur = dur;
    if (dates.isDay(g('date')) && time) { b.day = g('date'); b.start = +time[1] * 60 + +time[2]; }
    if (created) b.createdAt = Date.UTC(+created[1], +created[2] - 1, +created[3], +created[4], +created[5]);
    if (st) b.status = st;
    if (g('firstname')) b.first = g('firstname');
    if (g('lastname')) b.last = g('lastname');
    if (g('email')) b.email = g('email');
    if (g('phone')) b.phone = g('phone');
    if (services.length) b.services = services;
    if (att) b.staff = att;
    if (amount != null && Number.isFinite(amount)) { b.price = amount; b.paid = deposit || (st === 'paid' ? amount : 0); }
    out.push(b);
  }
  if (!out.length) problems.push({ file, line: 0, text: 'Aucune réservation dans ce fichier WordPress (type sln_booking).' });
  // an export of the bookings alone names no service nor barber: the bookings the CSV lacks could not be taken
  else if (!titles.size) problems.push({ file, line: 0, text: 'Ni prestations ni barbiers dans ce fichier : refais l’export avec « Tout le contenu »' });
  return out;
}

/* ---------------- everything at once ---------------- */

/** Reads every dropped file and merges them: bookings deduplicated by ID across files, the WXR filling in what the CSV lacks. */
export function readFiles(files: { name: string; text: string }[]): Parsed {
  const problems: Problem[] = [];
  const reports: FileReport[] = [];
  const csv = new Map<number, WpBooking>();
  const wxr: WxrBooking[] = [];
  const clients: WpClient[] = [], giftcards: WpGift[] = [], packs: WpPack[] = [];
  for (const f of files) {
    const text = f.text.replace(/^﻿/, '');
    if (/^\s*<\?xml|<rss[\s>]/.test(text.slice(0, 400))) {
      const list = readWxr(text, problems, f.name);
      wxr.push(...list);
      reports.push({ name: f.name, kind: 'wxr', rows: list.length });
      continue;
    }
    const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
    const cell = (r: string[], i: number | undefined) => (i == null ? '' : (r[i] || '').trim());
    let h = findHeader(rows, BOOKING_HEADERS, ['id', 'when']);
    if (h) {
      let n = 0, dupes = 0;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i], c = h.c;
        const wp = Number(cell(r, c.id));
        const line = i + 1;
        if (!wp) { problems.push({ file: f.name, line, text: 'Ligne sans ID' }); continue; }
        if (csv.has(wp)) { dupes++; continue; }
        const when = parseWhen(cell(r, c.when));
        const status = parseStatus(cell(r, c.status));
        if (!when) { problems.push({ file: f.name, line, text: 'Date illisible : « ' + cell(r, c.when) + ' »' }); continue; }
        if (!status) { problems.push({ file: f.name, line, text: 'État inconnu : « ' + cell(r, c.status) + ' »' }); continue; }
        const created = cell(r, c.created) ? parseWhen(cell(r, c.created)) : null;
        const { price, deposit } = parsePrice(cell(r, c.price));
        csv.set(wp, {
          wp, day: when.day, start: when.min, createdAt: created ? dates.instantOf(created.day, created.min) : undefined,
          first: cell(r, c.first), last: cell(r, c.last), email: cell(r, c.email).toLowerCase(), phone: cell(r, c.phone),
          services: cell(r, c.services).split(/\s*,\s*/).filter(Boolean), staff: cell(r, c.staff).split(/\s*,\s*/)[0] || '',
          // a deposit paid online counts whatever the status ('Confirmé' with '(10 € déjà payé en acompte)')
          price, paid: deposit || (status === 'paid' ? price || 0 : 0), status, noShow: false, note: ''
        });
        n++;
      }
      reports.push({ name: f.name, kind: 'bookings', rows: n, dupes });
      continue;
    }
    if ((h = findHeader(rows, GIFT_HEADERS, ['code', 'amount']))) {
      let n = 0;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i];
        const amount = parseMoney(cell(r, h.c.amount));
        if (!cell(r, h.c.code) || amount == null) { problems.push({ file: f.name, line: i + 1, text: 'Carte sans code ou sans solde' }); continue; }
        if (amount < 0 || amount > 100000) { problems.push({ file: f.name, line: i + 1, text: 'Solde hors limites (1 000 € au plus) : reprends-la à la caisse' }); continue; }
        const exp = cell(r, h.c.expires);
        giftcards.push({ code: cell(r, h.c.code), amount, ...(exp && localDay(exp) ? { expires: localDay(exp) } : {}) });
        n++;
      }
      reports.push({ name: f.name, kind: 'giftcards', rows: n });
      continue;
    }
    if ((h = findHeader(rows, PACK_HEADERS, ['phone', 'left']))) {
      let n = 0;
      for (let i = h.at + 1; i < rows.length; i++) {
        const r = rows[i];
        const left = parseInt(cell(r, h.c.left), 10);
        const expires = localDay(cell(r, h.c.expires));
        if (!(left > 0) || !expires) { problems.push({ file: f.name, line: i + 1, text: 'Abonnement sans coupes restantes ou sans date d’expiration' }); continue; }
        packs.push({ phone: cell(r, h.c.phone), first: cell(r, h.c.first), last: cell(r, h.c.last), left, expires });
        n++;
      }
      reports.push({ name: f.name, kind: 'packs', rows: n });
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
      reports.push({ name: f.name, kind: 'customers', rows: n });
      continue;
    }
    reports.push({ name: f.name, kind: 'unknown', rows: 0 });
  }
  // the WXR fills in what the CSV does not have; a booking only in the WXR is taken from it when complete
  for (const w of wxr) {
    const b = csv.get(w.wp);
    if (b) {
      if (w.uniq) b.uniq = w.uniq;
      if (w.prefix) b.prefix = w.prefix;
      if (w.note) b.note = w.note;
      if (w.dur) b.dur = w.dur;
      if (w.noShow) b.noShow = true;
      if (!b.phone && w.phone) b.phone = w.phone;
      if (!b.email && w.email) b.email = w.email.toLowerCase();
    } else if (w.day && w.start != null && w.status && w.services && w.services.length) {
      csv.set(w.wp, { first: '', last: '', phone: '', staff: '', price: null, paid: 0, noShow: false, note: '', ...w, email: (w.email || '').toLowerCase() } as WpBooking);
    }
  }
  const bookings = [...csv.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.start - b.start));
  return { bookings, clients, giftcards, packs, files: reports, problems };
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
export type Identity = { phone?: string; prefix?: string; email?: string };
/** Where a booking an earlier run brought in stands now (POST /api/v1/import/preview). */
export type Prior = { wp: number; day: string; start: number; dur: number; staffId: string; status: string; open: boolean; movedHere: boolean };
type Has = { has(wp: number): boolean };

const nameOf = (x: { first?: string; last?: string }) => [x.first, x.last].filter(Boolean).join(' ') || 'Sans nom';

/** People across every file: the same number or the same e-mail is the same person (as the server links them). */
export function people(p: Parsed) {
  const byKey = new Map<string, number>();
  const ids: Identity[][] = [];
  const add = (x: { phone: string; prefix?: string; email: string }) => {
    const phone = x.phone ? normPhoneImport(x.phone, x.prefix) : null;
    const email = x.email && isEmail(x.email) ? x.email : '';
    const keys = [phone ? 'p:' + phone : '', email ? 'e:' + email : ''].filter(Boolean);
    if (!keys.length) return -1;
    let g = keys.map((k) => byKey.get(k)).find((v) => v != null);
    if (g == null) { g = ids.length; ids.push([]); }
    for (const k of keys) byKey.set(k, g);
    ids[g].push({ ...(phone ? { phone: x.phone, prefix: x.prefix } : {}), ...(email ? { email } : {}) });
    return g;
  };
  return { add, ids };
}

const mapped = (b: WpBooking, map: Mapping) => b.services.length > 0 && b.services.every((n) => !!map.services[n]);

/**
 * What a re-run does to a booking an earlier run brought in: the same rules as the server's delta()
 * (commands/import.js). Nothing once it was handled here (checked in, paid, moved in the agenda).
 */
export function change(b: WpBooking, k: Prior, staffId: string, now: number, today: string, chairs?: Set<string>): 'cancel' | 'move' | 'close' | null {
  if (!k.open) return null;
  const out = outcome(b, now, k.dur);
  if (out === 'cancelled') return 'cancel';
  if (out === 'done' || out === 'no_show') return k.day < today ? 'close' : null;
  if (out !== 'booked') return null;
  const sid = staffId && staffId !== LEGACY && (!chairs || chairs.has(staffId)) ? staffId : k.staffId;
  return (b.day !== k.day || b.start !== k.start || sid !== k.staffId) && !k.movedHere ? 'move' : null;
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

/**
 * What the import would do, before anything is sent: only the rows that will be sent are counted. `known` holds the
 * groups that already have a file of the salon, `again` those an earlier run created (POST /api/v1/import/preview),
 * `imported` the bookings an earlier run brought in and where they stand now, `chairs` the active chairs.
 */
export function preview(p: Parsed, map: Mapping, now: number, o: { known?: Set<number>; again?: Set<number>; imported?: Map<number, Prior>; chairs?: Set<string>; today?: string } = {}) {
  const known = o.known || new Set<number>(), again = o.again || new Set<number>(), imported = o.imported || new Map<number, Prior>();
  const today = o.today || dates.localParts(now).day;
  const P = people(p);
  const groups = new Set<number>();
  const counts = { newClients: 0, merged: 0, past: 0, noShow: 0, upcoming: 0, cancelled: 0, skipped: 0, unmapped: 0, already: 0, toCancel: 0, toMove: 0, toClose: 0, giftcards: p.giftcards.length, packs: p.packs.length };
  const review: ReviewRow[] = [];
  const lanes = new Map<string, { start: number; dur: number }[]>();
  for (const b of p.bookings) {
    const g = P.add(b);
    const row = { wp: b.wp, day: b.day, start: b.start, name: nameOf(b) };
    const k = imported.get(b.wp);
    if (k) {
      const ch = b.status === 'error' ? null : change(b, k, map.staff[b.staff] || '', now, today, o.chairs);
      if (ch === 'cancel') { counts.toCancel++; review.push({ ...row, kind: 'cancel', text: 'Annulé sur l’ancien site depuis le premier import : sera annulé ici' }); }
      else if (ch === 'move') { counts.toMove++; review.push({ ...row, kind: 'move', text: 'Déplacé sur l’ancien site depuis le premier import : sera déplacé ici' }); }
      else if (ch === 'close') counts.toClose++;
      else counts.already++;
      continue;
    }
    const out = outcome(b, now);
    if (!out) { counts.skipped++; continue; }
    if (!mapped(b, map)) {
      counts.unmapped++;
      review.push({ ...row, kind: 'service', text: 'Prestation inconnue : ' + (b.services.filter((n) => !map.services[n]).join(', ') || 'aucune') + ' (ligne ignorée)' });
      continue;
    }
    if (g >= 0) groups.add(g);
    if (b.phone && !normPhoneImport(b.phone, b.prefix)) review.push({ ...row, kind: 'phone', text: 'Numéro illisible : « ' + b.phone + ' »' });
    if (!b.phone && !b.email) review.push({ ...row, kind: 'phone', text: 'Ni numéro ni e-mail : rendez-vous sans fiche client' });
    if (out === 'done') counts.past++;
    else if (out === 'no_show') counts.noShow++;
    else if (out === 'cancelled') counts.cancelled++;
    else {
      counts.upcoming++;
      const staffId = map.staff[b.staff] || '';
      if (!staffId || staffId === LEGACY || (o.chairs && !o.chairs.has(staffId))) { review.push({ ...row, kind: 'staff', text: 'À venir : choisis un barbier actif pour « ' + (b.staff || 'Sans barbier') + ' »' }); continue; }
      const lane = b.day + '|' + staffId, dur = b.dur || 30;
      const list = lanes.get(lane) || [];
      if (list.some((x) => x.start < b.start + dur && b.start < x.start + x.dur)) review.push({ ...row, kind: 'overlap', text: 'Chevauche un autre rendez-vous à venir du fichier' });
      lanes.set(lane, [...list, { start: b.start, dur }]);
    }
  }
  for (const c of p.clients) { const g = P.add(c); if (g >= 0) groups.add(g); }
  // a file an earlier run created is neither new nor merged (the server counts it as neither)
  for (const g of groups) if (!again.has(g)) counts[known.has(g) ? 'merged' : 'newClients']++;
  return { counts, review, identities: P.ids };
}

const cut = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) : undefined) || undefined;
/** A value the server would refuse (and with it the whole batch) is left out instead: a 12-hour WXR duration. */
const within = (v: number | null | undefined, min: number, max: number) => (v != null && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/**
 * The rows for POST /api/v1/import/batch (cut into requests by `chunks`). Bookings an earlier run brought in are
 * sent again, even with a service left unmatched: the server carries over what changed since (cancelled, moved).
 */
export function toRows(p: Parsed, map: Mapping, imported: Has = new Set<number>()) {
  const appts = [];
  for (const b of p.bookings) {
    if (b.status === 'error') continue;
    const again = imported.has(b.wp);
    if (!again && !mapped(b, map)) continue;
    appts.push({
      wp: b.wp, uniq: b.uniq, day: b.day, start: b.start, dur: within(b.dur, 5, 600), createdAt: b.createdAt,
      first: cut(b.first, 60), last: cut(b.last, 60), phone: cut(b.phone, 32), prefix: cut(b.prefix, 6), email: cut(b.email, 160),
      serviceIds: mapped(b, map) ? [...new Set(b.services.map((n) => map.services[n]))].slice(0, 6) : [], staffId: map.staff[b.staff] || LEGACY,
      price: within(b.price, 0, 1000000), paid: within(b.paid, 1, 1000000), status: b.status, noShow: b.noShow || undefined, note: cut(b.note, 300)
    });
  }
  const clients = p.clients.map((c) => ({ first: cut(c.first, 60), last: cut(c.last, 60), phone: cut(c.phone, 32), email: cut(c.email, 160), notes: cut(c.notes, 1000) }));
  const giftcards = p.giftcards.map((g) => ({ code: g.code.slice(0, 40), amount: g.amount, expires: g.expires }));
  const packs = p.packs.map((k) => ({ phone: cut(k.phone, 32), first: cut(k.first, 60), last: cut(k.last, 60), left: Math.min(50, k.left), expires: k.expires }));
  return { clients, appts, giftcards, packs };
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
