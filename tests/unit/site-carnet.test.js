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
  assert.ok(site.includes('Cette formule demande un compte&nbsp;: c’est ce qui garde tes 5 visites.'));
  assert.ok(site.includes("[n + ' visites', '1 par semaine', per]"), '« 5 visites · 1 par semaine · 16 € la visite »');
  assert.ok(site.includes("' semaines de suite. '") && site.includes('Une semaine sautée est perdue.') && site.includes('Une semaine sautée se rattrape une fois.'));
  assert.ok(!/sans (la )?barbe|hors barbe|pas la barbe/i.test(site.slice(site.indexOf("{ id: 'ab'"), site.indexOf("{ id: 'ab'") + 400)), 'the formule includes the beard upkeep');
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
  // (after a child, most often a brother or a sister; the booking is then one of several people)
  assert.match(site, /this\.setState\(\{ bk: Object\.assign\(this\.bkEmpty\(\), \{ party: party, mbr: b\.mbr, day: party\[0\]\.day, gfor: b\.gfor === 'child' \? 'child' : hasMe \? 'other' : 'me', multi: true, wide: false \}\) \}\);/);
  assert.ok(site.includes("const FOR_TITLE = { svc: 'Quelle coupe ', who: 'Avec qui ', when: 'Quand ' };"));
  assert.ok(site.includes('Cette personne, c’est'));
  assert.ok(site.includes("'Total pour ' + everyone.length + ' personnes : '"));
  assert.ok(site.includes('>Modifier</button>') && site.includes('bkEdit(to)'));
  // a carnet is never offered to an added person
  // (nor to a booking of several people, nor for another adult: it is personal)
  assert.ok(site.includes("!(f.pack && (party.length || b.mbr || b.moving || b.multi || b.gfor === 'other'))"));
});

test('« C’est pour qui ? » opens the booking: four choices at the top of the first step, « Pour moi » by default, the details only confirm', () => {
  // the first thing of step 1, above « Comme la dernière fois ? » and the services
  const svc = site.slice(site.indexOf('<sc-if value="{{isSvc}}"'), site.indexOf('<sc-if value="{{isWho}}"'));
  assert.ok(svc.indexOf('{{svcEntry}}') > 0 && svc.indexOf('{{svcEntry}}') < svc.indexOf('{{hasRebook}}') && svc.indexOf('{{hasRebook}}') < svc.indexOf('{{svcGroups}}'));
  assert.ok(site.includes("[['me', 'Pour moi'], ['child', 'Pour mon enfant'], ['other', 'Pour quelqu’un d’autre'], ['multi', 'À plusieurs']]"));
  assert.ok(/gfor: 'me', multi: false,/.test(site), '« Pour moi » by default');
  // no step added, the standard order kept (docs/refonte-conventions.md)
  assert.ok(site.includes("const BK_ORDER = ['svc', 'who', 'when', 'info'];"));
  // not from the member's link, a move, nor « Modifier »
  assert.ok(site.includes("v.svcEntry = step === 'svc' && party.length === 0 && !b.moving && !b.mbr && !b.keep && !v.noMenu;"));
  // the details confirm in one line, and « Changer » opens the three choices again
  assert.ok(site.includes('v.forOpen = v.canFor && (!b.forSeen || !!b.forEdit);') && site.includes('>Changer</button>'));
  // « À plusieurs »: the next person is the way on, and a tap while the slot is being kept is not lost
  assert.ok(site.includes("v.addLead = v.canAdd && !!b.multi && party.length === 0;") && site.includes('if (cur.addQ) this.bkAdd(kept);'));
});

test('the free slots are read once for the whole sheet, and the sheet opens on slots already asked', () => {
  assert.ok(site.includes("'/api/public/availability?days=' + WIN + '&all=1'"));
  // asked with the salon when the page opens, never after it
  assert.ok(/init: function \(\) \{ const p = Promise\.all\(\[loadSalon\(\), loadMemberships\(\)\]\)[^\n]*fetchAll\(0\)/.test(site));
  // a salon that does not know this read: one read per service and barber, as before
  assert.ok(site.includes('if (e && (e.status === 400 || e.status === 404)) bulkOff = true;'));
  // moving a booking keeps its own read (its slot left out)
  assert.ok(site.includes('if (moving || bulkOff) fetchAv(f, who, w);'));
  // no spinner in the way: grey boxes of the slots' height while the first read is on its way
  assert.ok(site.includes('<div class="sk" role="status">') && !site.includes('<p class="ld" role="status"><i aria-hidden="true"></i>On regarde les créneaux libres'));
  // the sheet and its steps answer within 300 ms
  assert.ok(site.includes('.bk.open{transform:none;visibility:visible;transition:transform .3s var(--ease)}') && site.includes('.st{animation:stIn .18s var(--ease) both}'));
});

test('no em dash in what the new screens say', () => {
  for (const m of site.matchAll(/(ser[A-Z]\w*|acc[A-Z]\w*|partyTotal|editSvcLabel) = [^\n]*/g)) assert.ok(!m[0].includes('—'), m[0].slice(0, 80));
});
