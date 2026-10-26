// Ton rendez-vous. What this browser remembers (memory.ts, never sent anywhere): his next appointment with
// a live countdown, his calendar and the way there; or, once it is past, how old his cut is and the same
// thing again with the same barber, in one tap. A first visit shows nothing at all.
import { dates, eur, plural } from '../../../lib/format';
import * as S from '../../../site-kit/salon';
import * as M from '../../../site-kit/memory';
import { AGING, SHOP } from '../../../site-kit/content';
import { $, h, svg, ARROW, OUT, bookAttrs, dayName, keepFocus, mono, safeUrl, whenWords } from '../dom';
import { barber, knownPool, pool, slugsOf, total } from '../store';

/** "Dans 2 j 4 h", "Dans 3 h 20", "Dans 12 min", "C’est maintenant" */
export function countdown(day: string, start: number, len: number) {
  const t0 = dates.instantOf(day, start), now = S.now();
  if (now >= t0) return now < t0 + len * 60000 ? 'C’est maintenant' : 'Terminé';
  const min = Math.ceil((t0 - now) / 60000), d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60), mm = min % 60;
  if (d) return 'Dans ' + d + ' j' + (hh ? ' ' + hh + ' h' : '');
  if (hh) return 'Dans ' + hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  return 'Dans ' + plural(mm, 'minute');
}

// Europe/Paris spelled out, so a calendar that doesn't know the zone still places the hour right
const VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];
/** RFC 5545: lines of 75 octets at most, continued on the next line after a space */
function fold(line: string) {
  const enc = new TextEncoder(), out: string[] = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function ics(k: M.Kept) {
  const d = k.day.replace(/-/g, ''), t = (m: number) => dates.hhmm(m).replace(':', '') + '00';
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
  const manage = safeUrl(k.manage);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//En direct//FR', ...VTZ, 'BEGIN:VEVENT', 'UID:' + k.code + '@larchitecte',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
    'DTSTART;TZID=Europe/Paris:' + d + 'T' + t(k.start), 'DTEND;TZID=Europe/Paris:' + d + 'T' + t(k.start + k.dur),
    'SUMMARY:' + esc(SHOP.name + ' · ' + k.services), 'LOCATION:' + esc(SHOP.address + ', ' + SHOP.city),
    'DESCRIPTION:' + esc((k.staff ? 'Avec ' + k.staff + '. ' : '') + 'Code ' + k.code + '.' + (manage ? ' ' + manage : '')), manage ? 'URL:' + manage : '', 'END:VEVENT', 'END:VCALENDAR']
    .filter(Boolean).map(fold).join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  const a = h('a', { href: url, download: 'rdv-larchitecte-' + k.code + '.ics', hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

let cur: M.Kept | null = null;

// Both cards in two halves: when (left) and what, with the actions (right), side by side from 700 px.
function upcomingCard(k: M.Kept) {
  const b = barber(k.staffId);
  const first = M.firstName();
  const manage = safeUrl(k.manage), pay = safeUrl(k.payUrl);
  const cal = h('button', { type: 'button', class: 'btn ghost sm', 'data-fk': 'cal' }, 'Ajouter à l’agenda');
  cal.addEventListener('click', () => ics(k));
  return [
    h('div', { class: 'me-l' },
      h('p', { class: 'me-k' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), first ? first + ', ton rendez-vous' : 'Ton rendez-vous'),
      h('h2', { class: 'me-w', id: 't-me' }, dayName(k.day), h('br'), h('em', {}, dates.fmtTime(k.start))),
      h('p', { class: 'me-cd', 'data-cd': '' }, countdown(k.day, k.start, k.dur))),
    h('div', { class: 'me-r' },
      h('p', { class: 'me-s' }, b ? mono(b, 'mono sm') : null, h('span', {}, k.services + (k.staff ? ' · avec ' + k.staff : ''))),
      k.status === 'pending' && pay ? h('p', { class: 'me-pay' }, 'Acompte à régler pour confirmer. ', h('a', { href: pay }, 'Régler l’acompte')) : null,
      h('div', { class: 'me-a' }, cal,
        h('a', { class: 'btn ghost sm', href: SHOP.maps, target: '_blank', rel: 'noopener', 'data-fk': 'map' }, 'Itinéraire', svg(OUT)),
        manage ? h('a', { class: 'tl', href: manage, 'data-fk': 'manage' }, 'Déplacer ou annuler') : null))
  ];
}

function lastCard(k: M.Kept) {
  const days = M.daysSince(k.day);
  const b = barber(k.staffId);
  const slugs = slugsOf(k.serviceIds);
  const first = M.firstName();
  const line = AGING[Math.min(AGING.length - 1, Math.floor(days / 7))];
  const next = slugs.length && b ? (knownPool(slugs) || []).find((f) => f.key === b.key) : null;
  if (slugs.length && !knownPool(slugs)) pool(slugs).then(paintMe, () => {});
  const go = h('button', { type: 'button', class: 'btn me-go', 'data-fk': 'go' });
  if (next && b) {
    bookAttrs(go, { slugs, staff: b.key, day: next.day, start: next.m, source: 'me-rebook' });
    go.append(h('span', {}, whenWords(next.day, next.m).replace(/^./, (c) => c.toUpperCase())), h('small', {}, 'avec ' + b.name), svg(ARROW));
    go.setAttribute('aria-label', 'Réserver la même chose ' + whenWords(next.day, next.m) + ' avec ' + b.name);
  } else {
    bookAttrs(go, { slugs, staff: b?.key || null, source: 'me-rebook' });
    go.append(h('span', {}, 'Même chose'), svg(ARROW));
  }
  const other = h('button', { type: 'button', class: 'tl', 'data-fk': 'other' }, 'Un autre créneau');
  bookAttrs(other, { slugs, staff: b?.key || null, source: 'me-other' });
  const t = total(slugs);
  return [
    h('div', { class: 'me-l' },
      h('p', { class: 'me-k' }, first ? 'Bon retour, ' + first : 'Bon retour'),
      h('h2', { class: 'me-w', id: 't-me' }, days <= 0 ? 'Ta coupe est toute fraîche.' : 'Ta coupe a ' + plural(days, 'jour') + '.'),
      h('p', { class: 'me-cd' }, line)),
    h('div', { class: 'me-r' },
      h('p', { class: 'me-s' }, b ? mono(b, 'mono sm') : null, h('span', {}, (k.services || t.names.join(' + ')) + (b ? ' · avec ' + b.name : '') + (t.price ? ' · ' + (t.from ? 'dès ' : '') + eur(t.price) : ''))),
      h('div', { class: 'me-a' }, go, other))
  ];
}

/** What the kit remembers; a record it can't read must not take the page down with it. */
function remembered(): { up: M.Kept | null; last: M.Kept | null } {
  try { const up = M.upcoming(); return { up, last: up ? null : M.lastVisit() }; } catch { return { up: null, last: null }; }
}

export function paintMe() {
  const host = $('[data-me]')!;
  const { up, last } = remembered();
  cur = up;
  host.hidden = !up && !last;
  host.classList.toggle('is-up', !!up);
  if (up || last) keepFocus(host, () => host.replaceChildren(...(up ? upcomingCard(up) : lastCard(last!)).filter(Boolean) as Node[]));
  else host.replaceChildren();
  // the hero's main button: once the card offers his usual, the hero offers the rest of the menu
  const cta = $('[data-hero-cta]');
  if (cta) {
    const again = !up && !!last && slugsOf(last.serviceIds).length > 0;
    bookAttrs(cta, { source: again ? 'hero-other' : 'hero' });
    cta.classList.toggle('ghost', again);
    cta.querySelector('span')!.textContent = again ? 'Autre chose ?' : 'Réserver';
    cta.querySelector('small')!.textContent = again ? 'toute la carte' : 'sans compte · 1 min';
  }
}
/** Once a minute: only the countdown moves. */
export function tickMe() {
  if (!cur) return;
  const el = $('[data-cd]');
  if (!el) return;
  try { if (dates.instantOf(cur.day, cur.start + cur.dur) <= S.now()) { paintMe(); return; } } catch { return; }
  el.textContent = countdown(cur.day, cur.start, cur.dur);
}
