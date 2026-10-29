// How the sign-in reads, shows and counts: the number typed, the code pasted, the seconds before « Renvoyer ».

/** as server/lib/util.js normPhone reads a number: 06…, +33 6…, 0033 6…, or another country's +… */
export function digits(v: string) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+33')) d = '0' + d.slice(3);
  return d;
}
export const validPhone = (v: string) => { const d = digits(v); return /^0[1-9]\d{8}$/.test(d) || /^\+\d{8,15}$/.test(d); };

/** The number as it is shown back: « 06 12 34 56 78 » for a French one (+33 6… too), as typed for another country's. */
export function showPhone(v: string) {
  const d = digits(v);
  return /^0\d{9}$/.test(d) ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : String(v || '').trim();
}

/**
 * The number in pairs while it is typed (06 12 34 56 78). Only a number that starts with 0 is cut: a +33… or another
 * country's number stays as typed, so the field never rewrites a prefix under the finger.
 */
export function typedPhone(v: string) {
  const s = v.replace(/[\s.\-()]/g, '');
  if (!/^0\d*$/.test(s) || s.startsWith('00')) return v;
  return s.slice(0, 10).replace(/(\d{2})(?=\d)/g, '$1 ');
}

/**
 * What a code field keeps of whatever lands in it (typed, pasted, filled in by the phone from the SMS): « 123 456 »,
 * « 123-456 » and « Ton code : 654321 (10 min) » all give six digits. A group of six digits wins over the others.
 */
export function codeOf(text: string) {
  const joined = String(text || '').replace(/(\d)[  .\-]+(?=\d)/g, '$1');
  const six = /(?:^|\D)(\d{6})(?!\d)/.exec(joined);
  return (six ? six[1] : joined.replace(/\D/g, '')).slice(0, 6);
}

/** 29 → « 0:29 » */
export const clock = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

/** The number the site remembers on this phone (lx-me, see /confidentialite), to spare typing it again. */
export function rememberedPhone() {
  try { const m = JSON.parse(localStorage.getItem('lx-me') || 'null'); return m && typeof m.phone === 'string' ? m.phone : ''; } catch { return ''; }
}

/** tel: href of a number written any way (« 04 91 00 00 00 »), or '' */
export function telHref(v: string) {
  const t = String(v || '').replace(/[^\d+]/g, '');
  return t ? 'tel:' + t : '';
}
