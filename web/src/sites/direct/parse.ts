// The command bar's ear: French free text in, a booking intent out. Pure and synchronous (no DOM, no
// salon clock): the caller passes today's date and the catalogue it knows, so the same phrase always
// reads the same way and the module can be checked with plain node.
//
//   parse('coupe + barbe demain après 17h avec frank', ctx)
//   → { slugs: ['ct'], staff: 'frank', day: '2026-10-28', win: { from: 1020, to: 1440, target: null }, ... }

export type Win = { from: number; to: number; target: number | null };
export type Intent = {
  slugs: string[];      // services, by slug ([] = not said)
  staff: string | null; // barber key, 'any', or null (not said)
  day: string | null;   // 'YYYY-MM-DD'
  win: Win | null;      // the wanted part of the day, in minutes after midnight
  asap: boolean;        // "le plus tôt", "dès que possible"
  again: boolean;       // "comme d’hab" — the page fills in the last visit
  timeLabel: string;    // "vers 18 h", "à partir de 17 h", "le matin"… ('' when no time was said)
  empty: boolean;       // nothing understood
};
export type Ctx = { today: string; now?: number; slugs: string[]; staff: string[] }; // now: minutes after midnight, for « dans 1 h »

/* ---------------- calendar, on 'YYYY-MM-DD' keys (UTC noon, no time zone involved) ---------------- */

const parts = (k: string) => { const [y, m, d] = k.split('-').map(Number); return { y, m, d }; };
const key = (dt: Date) => dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
const addDays = (k: string, n: number) => { const p = parts(k); return key(at(p.y, p.m, p.d + n)); };
const wdOf = (k: string) => { const p = parts(k); return at(p.y, p.m, p.d).getUTCDay(); };
/** a day and month without a year: this year, or next year once it has passed */
function dayMonth(d: number, m: number, today: string): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = parts(today);
  let dt = at(t.y, m, d);
  if (dt.getUTCMonth() !== m - 1) return null; // 31/11
  if (key(dt) < today) dt = at(t.y + 1, m, d);
  return key(dt);
}

/* ---------------- vocabulary ---------------- */

const MONTHS: [RegExp, number][] = [
  [/^janv/, 1], [/^fev/, 2], [/^mars/, 3], [/^avr/, 4], [/^mai/, 5], [/^juin/, 6],
  [/^juil/, 7], [/^aou/, 8], [/^sept/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12]
];
const MONTH_RE = 'janvier|janv|fevrier|fevr|fev|mars|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|octobre|oct|novembre|nov|decembre|dec';
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const STAFF: [string, RegExp][] = [
  ['jkut', /\b(j ?-?kut|jay ?kut|jaykut|jk)\b/],
  ['frank', /\bfran(c?k|c)\b/],
  ['soldat', /\b(le )?soldat\b/],
  ['esteban', /\b(e?steban|estebane)\b/]
];
const ANY = /\b(n'?importe (qui|lequel)|peu importe|sans preference|le premier (dispo|disponible|libre)|qui (tu veux|vous voulez))\b/;

const NB = ' ';
const fmt = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h + NB + 'h' + (m ? NB + String(m).padStart(2, '0') : ''); };

/** lower case, no accents, one space between words, padded so \b-free patterns can use spaces */
export function norm(s: string) {
  return ' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'").replace(/[^a-z0-9':\/.+\- ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

/* ---------------- the parser ---------------- */

export function parse(text: string, ctx: Ctx): Intent {
  let s = norm(text);
  const out: Intent = { slugs: [], staff: null, day: null, win: null, asap: false, again: false, timeLabel: '', empty: true };
  // a matched phrase is blanked out, so "28/10" is not read again as a time, nor "apres-midi" as "midi"
  const take = (re: RegExp) => { const m = re.exec(s); if (m) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length); return m; };

  /* days: explicit dates first, then the words */
  let m: RegExpExecArray | null;
  // "28/10" is a date, "18.30" is a time: a month over 12 leaves it to the time patterns below
  const dm = /\b(\d{1,2})\s?[\/.-]\s?(\d{1,2})(?:[\/.-](\d{2,4}))?\b/.exec(s);
  if (dm && +dm[2] >= 1 && +dm[2] <= 12 && (m = take(/\b(\d{1,2})\s?[\/.-]\s?(\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) out.day = dayMonth(+m[1], +m[2], ctx.today);
  else if ((m = take(new RegExp('\\b(\\d{1,2})(?:er)?\\s(' + MONTH_RE + ')\\.?\\b')))) {
    const mo = MONTHS.find(([re]) => re.test(m![2]));
    if (mo) out.day = dayMonth(+m[1], mo[1], ctx.today);
  } else if ((m = take(/\b(?:le|du) (\d{1,2})(?:er)?\b(?!\s?(?:h|:|heure))/))) {
    const t = parts(ctx.today), d = +m[1];
    out.day = dayMonth(d, t.m, ctx.today) && d >= t.d ? dayMonth(d, t.m, ctx.today) : dayMonth(d, t.m === 12 ? 1 : t.m + 1, ctx.today);
  }
  const night = /\b(ce soir|cette nuit)\b/.test(s), morning = /\bce matin\b/.test(s), noonToday = /\bcet? ?(apres[ -]?midi|aprem|aprm)\b/.test(s);
  if (!out.day) {
    if (take(/\bapres[ -]?demain\b/)) out.day = addDays(ctx.today, 2);
    else if (take(/\bdemain\b/)) out.day = addDays(ctx.today, 1);
    else if (take(/\b(aujourd'?hui|auj|ce jour|today)\b/) || night || morning || noonToday) out.day = ctx.today;
    else {
      const wd = new RegExp('\\b(' + WEEKDAYS.join('|') + ')( prochain| d\'apres| suivant)?\\b').exec(s);
      if (wd) {
        take(new RegExp(wd[0].trim()));
        const want = WEEKDAYS.indexOf(wd[1]), now = wdOf(ctx.today);
        let ahead = (want - now + 7) % 7;
        if (ahead === 0 && wd[2]) ahead = 7;          // "mardi prochain", said on a Tuesday
        if (wd[2] && wd[2].includes('apres')) ahead += 7; // "samedi d’après"
        out.day = addDays(ctx.today, ahead);
      }
    }
  }

  /* as soon as possible */
  if (take(/\b(le plus tot( possible)?|des que possible|au plus vite|au plus tot|asap|tout de suite|maintenant|rapidement|vite|urgent|la prochaine place|le prochain creneau)\b/)) out.asap = true;

  /* times: a range, a bound, a time, then the named parts of the day */
  const T = '(\\d{1,2})\\s?(?:h|:|\\.|heures?)\\s?(\\d{2})?';
  const hm = (h: string, mm?: string) => { let v = +h; if (v >= 1 && v <= 7) v += 12; return v > 23 ? null : v * 60 + (mm ? Math.min(59, +mm) : 0); };
  const named = (w: string): [number, number] | null => (w === 'midi' ? [720, 720] : null);
  // "dans 1 h", "dans 20 min": from now on, today (unread without a clock)
  if ((m = take(/\bdans (\d{1,2}) ?(h|heures?|min\w*)\b/)) && ctx.now != null) {
    const a = Math.ceil((ctx.now + +m[1] * (m[2][0] === 'h' ? 60 : 1)) / 5) * 5;
    if (a < 1440) { out.day = out.day || ctx.today; out.win = { from: a, to: 1440, target: a }; out.timeLabel = 'à partir de ' + fmt(a); }
  }
  if (!out.win && (m = take(new RegExp('\\bentre ' + T + ' et ' + T)))) {
    const a = hm(m[1], m[2]), b = hm(m[3], m[4]);
    if (a != null && b != null && b > a) { out.win = { from: a, to: b, target: null }; out.timeLabel = 'entre ' + fmt(a) + ' et ' + fmt(b); }
  }
  if (!out.win && (m = take(new RegExp("\\b(?:a partir d[e']|apres|des|pas avant|plus tard que|depuis) ?(?:" + T + '|(midi))')))) {
    const a = m[3] ? named(m[3])![0] : hm(m[1], m[2]);
    if (a != null) { out.win = { from: a, to: 1440, target: null }; out.timeLabel = 'à partir de ' + fmt(a); }
  }
  if (!out.win && (m = take(new RegExp("\\b(?:avant|pas apres|au plus tard a?) ?(?:" + T + '|(midi))')))) {
    const b = m[3] ? 720 : hm(m[1], m[2]);
    if (b != null) { out.win = { from: 0, to: b, target: null }; out.timeLabel = 'avant ' + (m[3] ? 'midi' : fmt(b)); }
  }
  if (!out.win && ((m = take(new RegExp('\\b(?:a |vers |pour |sur )?' + T))) || (m = take(/\b(?:a|vers) (\d{1,2})\b(?!\s?(?:\/|\d))/)))) {
    const t = hm(m[1], m[2]);
    if (t != null) { out.win = { from: t - 45, to: t + 45, target: t }; out.timeLabel = 'vers ' + fmt(t); }
  }
  if (!out.win) {
    if (take(/\b(fin de (la )?journee|fin d'apres[ -]?midi|en soiree|le soir|ce soir|soir|apres le (travail|boulot|taf|taff|bureau))\b/) || night) { out.win = { from: 1020, to: 1440, target: null }; out.timeLabel = 'en fin de journée'; }
    else if (take(/\b(apres[ -]?midi|aprem|aprm|apres manger|apres le dejeuner)\b/) || noonToday) { out.win = { from: 840, to: 1020, target: null }; out.timeLabel = 'l’après-midi'; }
    else if (take(/\b(matin|matinee|tot le matin|de bonne heure)\b/) || morning) { out.win = { from: 0, to: 720, target: null }; out.timeLabel = 'le matin'; }
    else if (take(/\b(a )?midi\b|\bpause dej\w*/)) { out.win = { from: 720, to: 840, target: 720 }; out.timeLabel = 'vers midi'; }
  }

  /* barbers */
  if (ANY.test(s)) out.staff = 'any';
  else for (const [k, re] of STAFF) if (ctx.staff.includes(k) && re.test(s)) { out.staff = k; break; }

  /* services: a cut, what goes with it, or one thing on its own */
  if (/\b(comme d'hab\w*|comme d'habitude|comme la derniere fois|la meme( chose)?|pareil|meme chose)\b/.test(s)) out.again = true;
  const has = (re: RegExp) => re.test(s);
  const cut = has(/\b(coupe[rs]?|couper|cheveux|tifs|degrade|fade|skin|taper|classique|tondeuse|boucles|raie|nuque|coiffure)\b/);
  const beard = has(/\b(barbe|taille|tailler|rasage|raser|moustache)\b/);
  const contour = has(/\b(contour|contours|lignes?)\b/);
  const care = has(/\b(entretien|entretenir)\b/);
  const cover = has(/\b(cover)\b/);
  const bleach = has(/\b(deco|decol\w*|decoloration|blond\w*|platine)\b/);
  const colour = has(/\b(couleur|coloration|colo|teinture|teindre)\b/);
  const silver = has(/\b(silver|gris|argent\w*)\b/);
  const trans = has(/\b(transfo\w*|changer de tete|changement de tete|nouvelle tete|relooking)\b/);
  const sub = has(/\b(abonnement|abo|forfait|5 coupes|cinq coupes)\b/);
  const add = (slug: string) => { if (ctx.slugs.includes(slug) && !out.slugs.includes(slug)) out.slugs.push(slug); };
  if (sub) add('ab');
  else if (trans) add('tr');
  else if (silver) add('si');
  else if (bleach) add(cut ? 'cd' : 'de');
  else if (cut) add(beard ? 'ct' : contour ? 'cc' : 'cl');
  else if (beard) add(care ? 'eb' : 'tb');
  else if (contour || care) add('eb');
  if (colour && !silver && !bleach) add('co');
  if (cover) add('cb');

  out.empty = !out.slugs.length && !out.staff && !out.day && !out.win && !out.asap && !out.again;
  return out;
}
