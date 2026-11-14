// The carnet on the public site, and a person added to a booking: what the page must keep saying and doing, read from
// its source (the flows themselves run in tests/e2e/demo/site-carnet.mjs and site-pour-autrui.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const site = readFileSync(new URL('../../public/site.html', import.meta.url), 'utf8');

test('the order of the booking steps never changes: the four other dates live inside step 3', () => {
  assert.match(site, /const BK_ORDER = \['svc', 'who', 'when', 'info'\];/);
  // « Tes 4 autres rendez-vous » is a sub-screen of « when » (the progress stays « Étape 3 sur 4 »), never a fifth step
  assert.match(site, /const inSeries = step === 'when' && b\.sub === 'series' && isPack;/);
  assert.match(site, /v\.isWhen = step === 'when' && !inSeries; v\.isSeries = inSeries;/);
  assert.ok(site.includes("inSeries ? 'Tes ' + (F.pack.credits - 1) + ' autres rendez-vous'"));
  assert.ok(site.includes("'Étape ' + (si + 1) + ' sur 4 · '"));
});

test('the carnet: its own words, an account before anything is bought, never for another adult', () => {
  assert.ok(site.includes('Cette formule demande un compte&nbsp;: c’est ce qui garde tes 5 coupes.'));
  assert.ok(site.includes("[n + ' coupes', n + ' semaines', per]"), '« 5 coupes · 5 semaines · 16 € la coupe »');
  assert.ok(site.includes('une semaine sans coupe est perdue.') && site.includes('une semaine manquée se rattrape une fois.'));
  assert.ok(site.includes('Je choisirai plus tard'));
  // bought only signed in (the server takes the file from the session), and the code is typed on the page
  assert.ok(site.includes("if (PF && PF.pack) return !!(s.acct && s.acct.signedIn) && this.bkGuestOk(s.bk);"));
  assert.ok(site.includes("call('POST', '/api/me/formule', o)") && site.includes('autocomplete="one-time-code"'));
  assert.ok(site.includes("(k === 'other' && isPack)"), '« Une autre personne » is off for a carnet');
  // every slot kept together, and one request id per attempt (a double tap is one purchase)
  assert.ok(site.includes("path === '/api/public/formule/holds' || path === '/api/me/formule'"));
  // 14:30 on the slot buttons, « 14 h 30 » everywhere else (docs/refonte-conventions.md)
  assert.ok(site.includes("t: LXE.hm(x.m), label: LXE.fmtH(x.m)"));
});

test('a person added to a booking chooses his own service: nothing preselected, the steps name him, each one is changed alone', () => {
  // the added person starts from an empty place (no service, barber nor time carried over)
  assert.match(site, /this\.setState\(\{ bk: Object\.assign\(this\.bkEmpty\(\), \{ party: party, mbr: b\.mbr, day: party\[0\]\.day, gfor: hasMe \? 'other' : 'me', wide: false \}\) \}\);/);
  assert.ok(site.includes("const FOR_TITLE = { svc: 'Quelle coupe ', who: 'Avec qui ', when: 'Quand ' };"));
  assert.ok(site.includes('Cette personne, c’est'));
  assert.ok(site.includes("'Total pour ' + everyone.length + ' personnes : '"));
  assert.ok(site.includes('>Modifier</button>') && site.includes('bkEdit(to)'));
  // a carnet is never offered to an added person
  assert.ok(site.includes('!(f.pack && (party.length || b.mbr || b.moving))'));
});

test('no em dash in what the new screens say', () => {
  for (const m of site.matchAll(/(ser[A-Z]\w*|acc[A-Z]\w*|partyTotal|editSvcLabel) = [^\n]*/g)) assert.ok(!m[0].includes('—'), m[0].slice(0, 80));
});
