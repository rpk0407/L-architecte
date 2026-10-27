// The old WordPress addresses on a live domain, for the cut-over day: each must answer with its redirect, query kept.
//   node scripts/check-redirects.mjs https://barberlarchitecte.com
// The same list as the end-to-end test (tests/e2e/prod/root-and-redirects.mjs), so the live check is exactly what the
// tests check before the deploy. Read only: it sends GET requests and follows nothing.
import { CASES } from '../tests/e2e/prod/root-and-redirects.mjs';

const base = String(process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error('Usage : node scripts/check-redirects.mjs https://barberlarchitecte.com');
  process.exit(2);
}
const origin = new URL(base).origin;
/** a Location on the same domain, written as the test writes it: path, query and anchor */
const local = (loc) => {
  if (!loc) return '';
  const u = new URL(loc, origin);
  return u.origin === origin ? u.pathname + u.search + u.hash : u.href;
};

const wrong = [];
for (const [from, status, to] of CASES) {
  try {
    const r = await fetch(origin + from, { redirect: 'manual' });
    const loc = local(r.headers.get('location'));
    if (r.status !== status || loc !== to) wrong.push(from + ' → ' + r.status + ' ' + (loc || '(sans Location)') + ', attendu ' + status + ' ' + to);
  } catch (err) { wrong.push(from + ' → ' + String(err && err.message || err)); }
}
if (wrong.length) {
  console.error(wrong.length + ' adresse(s) sur ' + CASES.length + ' ne redirigent pas comme prévu :\n' + wrong.join('\n'));
  process.exit(1);
}
console.log('Les ' + CASES.length + ' anciennes adresses redirigent comme prévu sur ' + origin + '.');
