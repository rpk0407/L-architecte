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
    'Ce code n’est pas le bon, ou il a expiré.', 'Tu pourras en demander un nouveau dans ', 'Recevoir un nouveau code', 'Pas de connexion. Vérifie ton réseau, puis réessaie.',
    'Trop d’essais pour le ', 'Par sécurité, on fait une pause. Réessaie dans quelques minutes, ou appelle le salon.', 'Appeler le salon', 'Retour au site',
    'Donne ton numéro de mobile pour recevoir ton code.', 'Une petite ', 'Une seule fois, pour être sûr que ce numéro est bien le tien : quel prénom as-tu donné au salon ?',
    'Comme sur ta réservation', 'Numéro retrouvé sur cet appareil. Ce n’est pas le tien ? Modifie-le.', 'Nouveau code envoyé', 'Le code est valable 10 minutes.'
  ]) assert.ok(s.includes(t), t);
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
