// The sign-in of /moi, signed out (web/src/moi/SignIn.tsx): what its pure helpers read and write, and what its screens keep
// promising in the source (one real code input, no maxLength that truncates a paste, the words the audit asked for).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codeOf, typedPhone, showPhone, validPhone, clock, telHref } from '../../web/src/moi/phone.ts';
import { perksLine } from '../../web/src/moi/perks.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('a code keeps its six digits whatever lands in the field', () => {
  assert.equal(codeOf('123456'), '123456');
  // pasted from Messages with a space, a dash or a dot
  assert.equal(codeOf('123 456'), '123456');
  assert.equal(codeOf('123-456'), '123456');
  assert.equal(codeOf('123 456'), '123456');
  assert.equal(codeOf(' 654321 '), '654321');
  // inside the sentence it was copied from, the group of six wins over the other digits
  assert.equal(codeOf('Ton code 654321 (10 min)'), '654321');
  assert.equal(codeOf('Le 28 oct. : 654321 est ton code'), '654321');
  // typed, one digit at a time, and never more than six
  assert.equal(codeOf('1'), '1');
  assert.equal(codeOf('12345'), '12345');
  assert.equal(codeOf('1234567'), '123456');
  assert.equal(codeOf(''), '');
  assert.equal(codeOf('abc'), '');
});

test('the number is set in pairs while it is typed, and a +33 is never rewritten under the finger', () => {
  assert.equal(typedPhone('0'), '0');
  assert.equal(typedPhone('06'), '06');
  assert.equal(typedPhone('061'), '06 1');
  assert.equal(typedPhone('0612345678'), '06 12 34 56 78');
  assert.equal(typedPhone('06 12 34 56 78 99'), '06 12 34 56 78');
  assert.equal(typedPhone('06.12.34.56.78'), '06 12 34 56 78');
  assert.equal(typedPhone('+33 6 12'), '+33 6 12');
  assert.equal(typedPhone('0033'), '0033');
  assert.equal(typedPhone('+44 7700 900123'), '+44 7700 900123');
  // shown back: a French number in pairs, whatever way it was written; another country's as typed
  assert.equal(showPhone('+33612345678'), '06 12 34 56 78');
  assert.equal(showPhone('0033 6 12 34 56 78'), '06 12 34 56 78');
  assert.equal(showPhone(' +44 7700 900123 '), '+44 7700 900123');
  assert.ok(validPhone('06 12 34 56 78') && validPhone('+33 6 12 34 56 78') && validPhone('+44 7700 900123'));
  assert.ok(!validPhone('') && !validPhone('0612') && !validPhone('06 12 34 56 7'));
});

test('the resend countdown and the salon’s phone link', () => {
  assert.equal(clock(30), '0:30');
  assert.equal(clock(29), '0:29');
  assert.equal(clock(5), '0:05');
  assert.equal(clock(0), '0:00');
  assert.equal(telHref('04 91 00 00 00'), 'tel:0491000000');
  assert.equal(telHref(''), '');
});

test('the promise lists only the advantages this salon really has', () => {
  const salon = (o) => ({ name: 'x', phone: '', email: '', address: '', carnet: false, membership: false, ...o });
  assert.equal(perksLine(salon({ carnet: true, membership: true }), true), 'Ta carte fidélité, ton carnet et ton abonnement');
  assert.equal(perksLine(salon({ carnet: true }), false), 'Ton carnet et ta carte cadeau');
  assert.equal(perksLine(salon({ carnet: true, membership: true }), false), 'Ton carnet et ton abonnement');
  assert.equal(perksLine(salon({}), true), 'Ta carte fidélité et ta carte cadeau');
  assert.equal(perksLine(salon({}), false), 'Ta carte cadeau');
});

test('the code field is one real input that autofills and takes a paste', () => {
  const f = read('web/src/moi/CodeField.tsx');
  // one input, never six
  assert.equal((f.match(/<input\b/g) || []).length, 1);
  for (const want of ['autoComplete="one-time-code"', 'inputMode="numeric"', 'name="code"', 'enterKeyHint="done"']) assert.ok(f.includes(want), want);
  // maxLength would cut « 123 456 » to 12345 before the non-digits are dropped
  assert.doesNotMatch(f, /maxLength/);
  assert.match(f, /codeOf\(e\.target\.value\)/);
  assert.match(f, /onPaste=\{paste\}/);
});

test('the sign-in says what it promised, in « tu »', () => {
  const s = read('web/src/moi/SignIn.tsx');
  for (const t of [
    'Ton prochain rendez-vous, tes reçus et tes avantages au même endroit. C’est facultatif : tu peux toujours réserver sans.',
    'Ton prochain rendez-vous, à déplacer ou annuler en un geste', 'Tes reçus et ton historique, quand tu veux',
    'Ton numéro de mobile', 'Celui de ta réservation, ou que le salon a pour toi.', 'Recevoir mon code par SMS',
    'Un SMS avec un code, c’est tout : pas de mot de passe, pas de pub.',
    'Ce SMS ne sert qu’à te connecter. Rien n’est vendu ni partagé à des fins publicitaires.', '/confidentialite#t-space',
    'Tu n’es encore jamais venu ? Ton espace s’ouvre avec ta première réservation.', 'Tu veux seulement retrouver un rendez-vous ?',
    'Si ce numéro est connu du salon, un code arrive par SMS au ', 'Rien reçu ?', 'Vérifie que c’est bien le numéro de ta réservation.', 'Tu peux demander jusqu’à 3 codes par jour.',
    'Ce code n’est pas le bon, ou il a expiré.', 'Recevoir un nouveau code', 'Pas de connexion. Vérifie ton réseau, puis réessaie.',
    'Trop d’essais pour le ', 'Par sécurité, on fait une pause. Réessaie dans quelques minutes, ou appelle le salon.', 'Appeler le salon', 'Retour au site',
    'Donne ton numéro de mobile pour recevoir ton code.', 'Une petite ', 'Une seule fois, pour être sûr que ce numéro est bien le tien : quel prénom as-tu donné au salon ?',
    'Comme sur ta réservation', 'Numéro retrouvé sur cet appareil. Ce n’est pas le tien ? Modifie-le.', 'Nouveau code envoyé', 'Le code est valable 10 minutes.'
  ]) assert.ok(s.includes(t), t);
  // after a wrong code the wait is counted once (« Renvoyer le code dans 0:28 »), not twice a few lines apart
  assert.doesNotMatch(s, /Tu pourras en demander un nouveau/);
  assert.equal((s.match(/'Renvoyer le code dans ' \+ clock\(wait\)/g) || []).length, 1);
  assert.doesNotMatch(s, /\{clock\(wait\)\}/);
  // the server's own sentence is no longer shown as it is, and the number form never stands in for a booking's code
  assert.doesNotMatch(s, /tu reçois un code par SMS/);
  assert.doesNotMatch(s, /Code incorrect ou expiré/);
  // a screen reader hears the step: the code field or the title takes the focus at every step
  assert.match(s, /codeRef\.current\?\.focus\(\)/);
  assert.match(s, /head\.current\?\.focus\(\)/);
  assert.match(s, /history\.pushState\(\{ moi: 1 \}/);
  assert.match(s, /flushSync/);
  // the page frame has its skip link
  assert.match(read('web/src/moi/SitePage.tsx'), /<a className="ms-skip" href="#main">Aller au contenu<\/a>/);
});

test('the first name is asked in the salon’s words, not in its jargon', () => {
  const r = read('server/http/routes-me.js');
  assert.match(r, /Ce n’est pas le prénom qu’on a pour ce numéro\. Réessaie\./);
  assert.doesNotMatch(r, /prénom de la fiche/);
  // the server's own answer to a start is untouched: the same words for every number
  assert.match(r, /export const START_MESSAGE = 'Si ce numéro est connu du salon, tu reçois un code par SMS\.';/);
});

test('the history entry always says what the page shows: a stale or used link leaves a number step whose next step pushes its own entry', () => {
  const s = read('web/src/moi/SignIn.tsx');
  // the entry of the number step carries { moi: 0 }: one helper, used where the page comes back to the number
  assert.match(s, /const flat = \(\) => history\.replaceState\(\{ moi: 0 \}, ''\);/);
  // a link that opens nothing (the entry was marked as the code step before the answer came) flattens it before showing the number
  assert.match(s, /flat\(\);\s*\n\s*setSending\(false\); setLink\(false\); setStep\('phone'\)/);
  // reset() ends on the number too, and a page that opens on the number does not trust a mark left by an earlier visit
  assert.match(s, /via\.current = \{ phone: '' \};\s*\n\s*flat\(\);/);
  assert.match(s, /if \(!\(enabled && garder\) && depth\(\) > 0\) flat\(\);/);
  // the step that follows pushes its own entry only when none is marked: that is what the arrow's history.back() relies on
  assert.match(s, /if \(depth\(\) < 1\) history\.pushState\(\{ moi: 1 \}, ''\);/);
});

test('the signed-out frame follows the phone’s dark mode with the values of the static pages', () => {
  const css = read('web/src/moi/moi.css');
  const pages = read('public/pages.css');
  // pages.css's dark tokens: --bg, --sf, --tx, --tx2, --ln, --ln2
  const dark = /@media \(prefers-color-scheme:dark\)\{\s*:root\{([^}]*)\}/.exec(pages);
  assert.ok(dark, 'pages.css has no dark tokens');
  const pc = {};
  for (const m of pages.matchAll(/--(encre2?|os|cendre):(#[0-9A-Fa-f]{6})/g)) pc[m[1]] = m[2].toUpperCase();
  assert.match(dark[1], /--bg:var\(--encre\);--sf:var\(--encre2\);--tx:var\(--os\);--tx2:var\(--cendre\);--ln:rgba\(236,232,224,\.14\);--ln2:rgba\(236,232,224,\.28\)/);
  const mine = /@media \(prefers-color-scheme: dark\) \{\s*html:not\(\.m-lit\)[\s\S]*?\n\}\n/.exec(css);
  assert.ok(mine, 'moi.css has no dark block for the signed-out frame');
  const b = mine[0].toUpperCase().replace(/\s+/g, ' ');
  assert.ok(b.includes('--PAPER: ' + pc.encre), 'paper is the pages’ --bg');
  assert.ok(b.includes('--CARD: ' + pc.encre2), 'card is the pages’ --sf');
  assert.ok(b.includes('--INK: ' + pc.os), 'ink is the pages’ --tx');
  assert.ok(b.includes('--INK2: ' + pc.cendre), 'ink2 is the pages’ --tx2');
  assert.ok(b.includes('--LINE: RGBA(236, 232, 224, .14)') && b.includes('--LINE2: RGBA(236, 232, 224, .28)'), 'lines are the pages’');
  // the signed-in space keeps its light: the page behind it is marked, and the frame never hard-codes a light-only colour
  assert.match(read('web/src/moi/main.tsx'), /function Shell\(.*\) \{\s*useLit\(\);/);
  assert.match(read('web/src/moi/lit.ts'), /classList\.add\('m-lit'\)/);
  // (the spinner on a red button is the one dark tint: it sits on red in both themes)
  const frame = css.slice(css.indexOf('/* the sign-in, signed out'), css.indexOf('/* the tab bar */')).replace(/\.c-btn \.ms-spin[^\n]*/, '');
  assert.doesNotMatch(frame, /#9E2A21|#2a2825|color: #fff|rgba\(15, 14, 13/, 'a light-only colour in the signed-out frame');
  // the title of the success moment is focused by script: no focus rectangle on it, as on the other titles
  assert.match(css, /\.ms-head h1:focus, \.ms-ok h1:focus \{ outline: none; \}/);
  assert.match(read('web/moi/index.html'), /content="#0F0E0D" media="\(prefers-color-scheme: dark\)"/);
});

test('the footer says what the static pages say, and strands no separator at the end of a line', () => {
  const f = read('web/src/moi/SitePage.tsx');
  const p = read('public/pages.js');
  // « © 2026 L’Architecte SAS · Pas de pistage, pas de mesure d’audience. »: the editor’s (legal) name, as pages.js writes it
  assert.ok(p.includes("'© ' + new Date().getFullYear() + ' ', h('span', { 'data-f': 'editor' }") && p.includes("var editor = sh.legalName || sh.name || '';"));
  assert.ok(p.includes(' · Pas de pistage, pas de mesure d’audience.'));
  assert.match(f, /© \{new Date\(\)\.getFullYear\(\)\} \{salon\.editor\} \{'·' \+ NB\}Pas de pistage, pas de mesure d’audience\./);
  assert.match(read('web/src/moi/salon.ts'), /editor: String\(sh\.legalName \|\| sh\.name \|\| DEFAULTS\.editor\)/);
  // the phone and the e-mail wrap as two items of a row; there is no « · » between them to be left at a line end
  assert.match(f, /<span className="ms-ft-ways">/);
  assert.doesNotMatch(f, /<\/a> · <\/>/);
});
