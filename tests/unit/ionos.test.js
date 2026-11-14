// Réglages › Connexion IONOS: the salon's mailbox (which variable is set, never a secret; the values to type; a refusal
// in plain words; SPF and DKIM read from the DNS) and its domain on the switch day (the Jour J card's own DNS report: the
// new site, still the old host, or half of it). Every DNS answer here is a stand-in: nothing reaches the network, and no
// SMTP server is ever called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at } from '../helpers.js';
import { browser } from '../api/client.js';
import { createRuntime, readConfig } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { SmtpError } from '../../server/messaging/smtp.js';
import { IONOS_SMTP, IONOS_SPF, mailDns, mailEnvOf, mailExpected, mailTrouble, mailVars } from '../../server/messaging/ionos.js';
import { dnsReport, isVercelIp, isVercelCname } from '../../server/http/routes-bascule.js';
import { salonDomain } from '../../server/http/routes-channels.js';

const DAY = '2026-11-03';
const PASS = 'Mot-De-Passe-Boite-42';
// the mailbox's user name differs from the sender here, so an answer that leaked it would show
const USER = 'boite.comptoir@barberlarchitecte.com';
const MAIL = { SMTP_HOST: 'smtp.ionos.fr', SMTP_PORT: '465', SMTP_USER: USER, SMTP_PASS: PASS, EMAIL_FROM: "Barber L'Architecte <rdv@barberlarchitecte.com>" };
const none = (h, type) => Object.assign(new Error('query' + type + ' ENODATA ' + h), { code: 'ENODATA' });
/** A resolver from a table: 'host|TYPE' first, then 'TYPE'; an Error is thrown; nothing listed is ENODATA. */
const resolver = (table) => { const asked = []; const f = async (host, type) => { asked.push(host + '|' + type); const v = table[host + '|' + type] ?? table[type]; if (v === undefined) throw none(host, type); if (v instanceof Error) throw v; return v; }; return Object.assign(f, { asked }); };

test('the variables: set or missing, the password never, the user name by its domain only, what is wrong in words', () => {
  const e = mailEnvOf(MAIL);
  assert.equal(JSON.stringify(e).includes(PASS), false);
  assert.equal(JSON.stringify(e).includes('boite.comptoir'), false, 'the user name stays out');
  assert.deepEqual([e.user, e.userDomain, e.pass], [true, 'barberlarchitecte.com', true]);
  const vars = mailVars(e, 'barberlarchitecte.com');
  assert.deepEqual(vars.map((v) => v.key), ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_REPLY_TO']);
  assert.ok(vars.filter((v) => v.key !== 'EMAIL_REPLY_TO').every((v) => v.set && v.ok && !v.note), JSON.stringify(vars));
  assert.equal(vars.find((v) => v.key === 'SMTP_USER').value, '…@barberlarchitecte.com');
  assert.equal(vars.find((v) => v.key === 'SMTP_PASS').value, '');
  assert.equal(JSON.stringify(vars).includes(PASS), false);
  // nothing set: everything but the optional ones is missing
  const empty = mailVars(mailEnvOf({}), '');
  assert.deepEqual(empty.filter((v) => !v.ok).map((v) => v.key), ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']);
  assert.equal(empty.find((v) => v.key === 'SMTP_PORT').value, '465 (par défaut)');
  // the usual mistakes
  const bad = mailVars(mailEnvOf({ ...MAIL, SMTP_HOST: 'mail.gandi.net', SMTP_PORT: '25', SMTP_USER: 'rdv', EMAIL_FROM: 'Salon <salon@gmail.com>' }), 'barberlarchitecte.com');
  const note = (k) => bad.find((v) => v.key === k).note;
  assert.match(note('SMTP_HOST'), /pas un serveur IONOS : pour la boîte du salon, c’est smtp\.ionos\.fr/);
  assert.match(note('SMTP_PORT'), /port 25 est fermé chez Vercel : mets 465/);
  assert.equal(bad.find((v) => v.key === 'SMTP_PORT').ok, false);
  assert.match(note('SMTP_USER'), /adresse complète de la boîte, par exemple rdv@barberlarchitecte\.com/);
  assert.match(note('EMAIL_FROM'), /pas une adresse de barberlarchitecte\.com/);
  const other = mailVars(mailEnvOf({ ...MAIL, EMAIL_FROM: 'rdv@autre-salon.fr' }), '');
  assert.match(other.find((v) => v.key === 'EMAIL_FROM').note, /Pas le même domaine que la boîte \(SMTP_USER\) : IONOS refuse l’envoi/);
  // what to type: IONOS's server and port, the mailbox on the salon's domain, the sender with the salon's name
  assert.deepEqual(mailExpected(mailEnvOf({}), 'barberlarchitecte.com', "L'Architecte"), { host: 'smtp.ionos.fr', port: '465', alt: '587', user: 'rdv@barberlarchitecte.com', from: "L'Architecte <rdv@barberlarchitecte.com>" });
  assert.equal(mailExpected(mailEnvOf({ EMAIL_FROM: 'contact@barberlarchitecte.com' }), 'barberlarchitecte.com', 'Salon').user, 'contact@barberlarchitecte.com', 'the sender already set is the mailbox');
  assert.equal(mailExpected(mailEnvOf({}), '', 'Salon').user, '');
  assert.deepEqual(IONOS_SMTP, { host: 'smtp.ionos.fr', port: '465', alt: '587' });
  // the configuration keeps it with the rest, the password as « set » only
  assert.equal(JSON.stringify(readConfig(MAIL).mailEnv).includes(PASS), false);
});

test('a refusal in plain words: wrong password, port blocked, sender off the domain, unknown host, IONOS’s hourly limit', () => {
  const t = (e) => mailTrouble(e).kind;
  assert.equal(t(new SmtpError('Identifiant ou mot de passe refusé', { stage: 'auth', code: 535 })), 'password');
  assert.match(mailTrouble(new SmtpError('x', { stage: 'auth', code: 535 })).hint, /SMTP_PASS \(le mot de passe de cette boîte, pas celui du compte IONOS\)/);
  assert.equal(t(new SmtpError('Le serveur d’e-mail ne répond pas à temps (smtp.ionos.fr:2525)', { stage: 'connect', why: 'timeout' })), 'port');
  // the other port than the one set: 465 refused → 587, 587 refused → 465, anything else → 465 then 587
  assert.match(mailTrouble(new SmtpError('x', { stage: 'connect', why: 'refused' }), { port: '465' }).hint, /^Essaie SMTP_PORT=587 \(STARTTLS\)/);
  assert.match(mailTrouble(new SmtpError('x', { stage: 'connect', why: 'refused' }), { port: '587' }).hint, /^Mets SMTP_PORT=465\./);
  assert.match(mailTrouble(new SmtpError('x', { stage: 'connect', why: 'refused' }), { port: '2525' }).hint, /SMTP_PORT=465 ; si ça ne passe toujours pas, 587/);
  assert.equal(t(new SmtpError('Expéditeur refusé', { stage: 'from', code: 550 })), 'sender');
  assert.match(mailTrouble(new SmtpError('x', { stage: 'from', code: 550 })).hint, /même domaine que la boîte .* depuis le 29 janvier 2024/);
  assert.equal(t(new SmtpError('Serveur d’e-mail introuvable : vérifie SMTP_HOST', { stage: 'connect', why: 'notfound' })), 'host');
  assert.equal(t(new SmtpError('Le serveur d’e-mail est occupé', { stage: 'from', code: 450 })), 'limit', 'a 450 is the limit, whatever the stage');
  assert.match(mailTrouble(new SmtpError('x', { code: 450 })).hint, /500 e-mails par heure au plus \(50 la première semaine\)/);
  assert.equal(t(new SmtpError('x', { why: 'cert' })), 'cert');
  // an outbox row keeps the words only: read from them
  assert.equal(t('Identifiant ou mot de passe refusé par le serveur d’e-mail : vérifie SMTP_USER'), 'password');
  assert.equal(t('Le serveur d’e-mail est occupé ou limite les envois, à réessayer plus tard (450 4.7.0 Mail send limit exceeded)'), 'limit');
  assert.equal(t('Expéditeur refusé : EMAIL_FROM doit être une adresse de la même boîte'), 'sender');
  assert.equal(t('Clé Brevo refusée : vérifie BREVO_API_KEY'), 'brevo');
  assert.equal(t('quelque chose d’autre'), 'other');
  assert.doesNotMatch(JSON.stringify(mailTrouble(new SmtpError('x', { stage: 'auth' }))), /—/);
});

test('SPF and DKIM: found and including IONOS, absent (with the line to add), another SPF, two of them, a resolver that fails', async () => {
  const D = 'barberlarchitecte.com';
  let r = await mailDns(resolver({ [D + '|TXT']: [['v=spf1 include:_spf-eu.ionos.com ~all'], ['google-site-verification=x']], ['s1-ionos._domainkey.' + D + '|CNAME']: ['s1.dkim.ionos.com'] }), D);
  assert.deepEqual([r.spf.state, r.spf.line], ['ok', 'SPF trouvé et inclut IONOS.']);
  assert.equal(r.dkim.state, 'ok');
  assert.match(r.dkim.line, /DKIM d’IONOS trouvé \(s1-ionos\._domainkey\)/);
  // absent: the record IONOS gives for it, and where to click
  r = await mailDns(resolver({}), D);
  assert.equal(r.spf.state, 'todo');
  assert.equal(r.spf.add, IONOS_SPF);
  assert.equal(IONOS_SPF, 'v=spf1 include:_spf-eu.ionos.com ~all');
  assert.match(r.spf.line, /^SPF absent/);
  assert.equal(r.dkim.state, 'todo');
  assert.match(r.dkim.line, /s1-ionos\._domainkey → s1\.dkim\.ionos\.com et s2-ionos\._domainkey → s2\.dkim\.ionos\.com/);
  // an SPF without IONOS (only Brevo): what to add in the same line
  r = await mailDns(resolver({ [D + '|TXT']: ['v=spf1 include:spf.brevo.com ~all'] }), D);
  assert.deepEqual([r.spf.state, r.spf.add], ['todo', 'include:_spf-eu.ionos.com']);
  assert.match(r.spf.line, /n’inclut pas IONOS/);
  // the American name and the old 1&1 one count as IONOS
  for (const v of ['v=spf1 include:_spf-us.ionos.com ~all', 'v=spf1 include:_spf.perfora.net include:_spf.kundenserver.de ~all']) assert.equal((await mailDns(resolver({ [D + '|TXT']: [v] }), D)).spf.state, 'ok', v);
  r = await mailDns(resolver({ [D + '|TXT']: ['v=spf1 include:_spf-eu.ionos.com ~all', 'v=spf1 include:spf.brevo.com ~all'] }), D);
  assert.equal(r.spf.state, 'warn');
  assert.match(r.spf.line, /Deux enregistrements SPF : un seul doit rester/);
  // DKIM read through its TXT when the resolver follows the CNAME
  r = await mailDns(resolver({ ['s2-ionos._domainkey.' + D + '|TXT']: [['v=DKIM1; k=rsa; p=MIIB']] }), D);
  assert.equal(r.dkim.state, 'ok');
  // a resolver that fails is a doubt, never a « no »
  const fail = Object.assign(new Error('queryTxt ESERVFAIL'), { code: 'ESERVFAIL' });
  r = await mailDns(resolver({ TXT: fail, CNAME: fail }), D);
  assert.deepEqual([r.spf.state, r.dkim.state], ['warn', 'warn']);
  assert.match(r.spf.line, /^Vérification impossible : queryTxt ESERVFAIL/);
});

test('the domain: the new site, still the old host, half of it (apex or www), no address, a doubt; any Vercel address counts', async () => {
  const D = 'barberlarchitecte.com', W = 'www.' + D, OLD = '217.160.0.36';
  const rep = (table) => dnsReport({ dnsResolve: resolver(table) }, D);
  // today: both at IONOS
  let r = await rep({ [D + '|A']: [OLD], [W + '|A']: [OLD] });
  assert.deepEqual([r.where, r.step.state], ['ionos', 'todo']);
  assert.match(r.step.line, /pointe vers 217\.160\.0\.36, pas vers le nouveau site/);
  assert.deepEqual(r.apex.old, [OLD]);
  // half: the apex moved, www still at IONOS
  r = await rep({ [D + '|A']: ['76.76.21.21'], [W + '|A']: [OLD] });
  assert.equal(r.where, 'half');
  assert.match(r.step.line, /^www\.barberlarchitecte\.com pointe encore chez IONOS \(217\.160\.0\.36\) : remplace-le par le CNAME www vers la cible que Vercel affiche/);
  // half: the old A left beside Vercel's
  r = await rep({ [D + '|A']: [OLD, '216.198.79.1'], [W + '|CNAME']: ['d1d4fc829fe7bc7c.vercel-dns-017.com'] });
  assert.equal(r.where, 'half');
  // all done, with a project's own address and www's CNAME, whose target answers addresses of its own (66.33.60.x)
  r = await rep({ [D + '|A']: ['64.29.17.65'], [W + '|CNAME']: ['d1d4fc829fe7bc7c.vercel-dns-017.com'], [W + '|A']: ['66.33.60.129', '76.76.21.22'] });
  assert.deepEqual([r.where, r.step.state, r.step.line], ['vercel', 'ok', D + ' pointe vers le nouveau site.']);
  assert.equal(r.www.vercel, true);
  assert.deepEqual(r.www.old, []);
  // no address at all, and a resolver that fails
  assert.equal((await rep({})).where, 'none');
  assert.equal((await rep({ A: new Error('queryA ESERVFAIL'), AAAA: new Error('x'), CNAME: new Error('x') })).where, 'unknown');
  // Vercel's registered ranges, and its CNAME names
  for (const ip of ['76.76.21.21', '76.76.21.164', '216.198.79.1', '216.198.79.65', '64.29.17.1']) assert.equal(isVercelIp(ip), true, ip);
  for (const ip of ['217.160.0.36', '76.76.22.1', '64.29.170.1']) assert.equal(isVercelIp(ip), false, ip);
  for (const n of ['cname.vercel-dns.com', 'cname.vercel-dns-0.com', 'd1d4fc829fe7bc7c.vercel-dns-017.com.']) assert.equal(isVercelCname(n), true, n);
  assert.equal(isVercelCname('vercel-dns.com.evil.fr'), false);
});

test('the salon’s domain: the public address, else the mailbox’s, never a free mail service, else the one the device remembers', () => {
  const s = { imports: { order: [], runs: new Map() } };
  const cfg = (x = {}, env = {}) => ({ publicUrl: '', ...x, mailEnv: mailEnvOf(env) });
  assert.equal(salonDomain(s, cfg({ publicUrl: 'https://barberlarchitecte.com' })), 'barberlarchitecte.com');
  assert.equal(salonDomain(s, cfg({ publicUrl: 'https://salon-x.vercel.app' }, { EMAIL_FROM: 'Salon <rdv@barberlarchitecte.com>' })), 'barberlarchitecte.com');
  assert.equal(salonDomain(s, cfg({}, { SMTP_USER: 'rdv@barberlarchitecte.com' })), 'barberlarchitecte.com');
  assert.equal(salonDomain(s, cfg({}, { EMAIL_FROM: 'larchitectebarber@gmail.com' }), '', 'barberlarchitecte.com'), 'barberlarchitecte.com', 'a gmail sender says nothing of the domain');
  assert.equal(salonDomain(s, cfg({ publicUrl: 'https://barberlarchitecte.com' }), 'autre.fr'), 'autre.fr', 'typed wins');
  assert.equal(salonDomain(s, cfg()), '');
});

test('the routes: owner only, no secret in any answer, the checks paced and mocked, none in the demo, a refusal explained', async () => {
  const clock = { now: at(DAY, 10, 0) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'tok-0123456789', PUBLIC_URL: 'https://salon-x.vercel.app', ...MAIL };
  const rt = await createRuntime({ env, store: memoryStore(), clock: () => clock.now });
  const o = browser(rt);
  assert.equal((await o.post('/api/setup', { token: 'tok-0123456789', name: 'Frank', email: 'patron@larchitecte.test', password: 'Pelabon-13013' })).status, 200);
  let r = await o.get('/api/v1/ionos');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text.includes(PASS), false, 'never the password');
  assert.equal(r.text.includes('boite.comptoir'), false, 'never the mailbox’s user name');
  assert.equal(r.json.domain, 'barberlarchitecte.com', 'from the mailbox, the public address being Vercel’s');
  assert.equal(r.json.stage, 'before');
  assert.equal(r.json.mail.provider, 'smtp');
  assert.equal(r.json.mail.state, 'ok');
  assert.deepEqual(r.json.mail.vars.filter((v) => !v.ok).map((v) => v.key), []);
  assert.match(r.json.mail.expected.from, / <rdv@barberlarchitecte\.com>$/);
  assert.equal(r.json.mail.expected.user, 'rdv@barberlarchitecte.com', 'the address to type, from the sender already set');
  assert.equal(r.json.mail.expected.host, 'smtp.ionos.fr');
  // the network checks: a stand-in resolver, never the real one
  const dnsR = resolver({ 'barberlarchitecte.com|A': ['217.160.0.36'], 'www.barberlarchitecte.com|A': ['217.160.0.36'], 'barberlarchitecte.com|TXT': ['v=spf1 include:_spf-eu.ionos.com ~all'], 's1-ionos._domainkey.barberlarchitecte.com|CNAME': ['s1.dkim.ionos.com'] });
  rt.dnsResolve = dnsR;
  // the Jour J read below also tries the old addresses: answered here, nothing leaves the process
  rt.fetch = async () => new Response('Introuvable', { status: 404 });
  r = await o.post('/api/v1/ionos/domain', { domain: 'https://www.barberlarchitecte.com/', refresh: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.domain, r.json.where, r.json.step.state], ['barberlarchitecte.com', 'ionos', 'todo']);
  assert.deepEqual(r.json.apex.a, ['217.160.0.36']);
  r = await o.post('/api/v1/ionos/mail-dns', { domain: 'barberlarchitecte.com' });
  assert.deepEqual([r.json.spf.state, r.json.dkim.state], ['ok', 'ok']);
  assert.ok(dnsR.asked.length > 0);
  assert.equal((await o.post('/api/v1/ionos/domain', { domain: 'pas un domaine' })).status, 400);
  // the Jour J card reads the same report, from the same minute's cache
  const asked = dnsR.asked.length;
  const b = await o.get('/api/v1/bascule?domain=barberlarchitecte.com');
  assert.equal(b.json.steps.find((x) => x.id === 'dns').state, 'todo');
  const ofDomain = (l) => l.filter((x) => /^(www\.)?barberlarchitecte\.com\|(A|AAAA|CNAME)$/.test(x)).length;
  assert.equal(ofDomain(dnsR.asked), ofDomain(dnsR.asked.slice(0, asked)), 'no second lookup for the domain (ancien. is the card’s own check)');
  // paced: twelve a minute per person
  let slow = 0;
  for (let i = 0; i < 14; i++) if ((await o.post('/api/v1/ionos/mail-dns', { domain: 'barberlarchitecte.com' })).status === 429) slow++;
  assert.ok(slow >= 1, 'paced');
  // a refusal of the mailbox: the server's words, and what they mean
  rt.email = { name: 'smtp', async send() { throw new SmtpError('Identifiant ou mot de passe refusé par le serveur d’e-mail : vérifie SMTP_USER (l’adresse complète) et SMTP_PASS', { stage: 'auth', code: 535 }); } };
  r = await o.post('/api/v1/messages/channels/test-email');
  assert.equal(r.status, 502);
  assert.equal(r.json.error.extra.trouble.kind, 'password');
  assert.equal(r.text.includes(PASS), false);
  // a barber (or anyone without the settings right) gets nothing of it
  const anon = browser(rt);
  assert.equal((await anon.get('/api/v1/ionos')).status, 401);

  // the demo: nothing checked on the network
  const demo = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, store: memoryStore(), clock: () => clock.now });
  const never = resolver({});
  demo.dnsResolve = never;
  const { DEMO } = await import('../../server/domain/seed.js');
  const d = browser(demo);
  assert.equal((await d.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  r = await d.post('/api/v1/ionos/domain', { domain: 'barberlarchitecte.com' });
  assert.deepEqual([r.json.demo, r.json.step.state], [true, 'info']);
  r = await d.post('/api/v1/ionos/mail-dns', { domain: 'barberlarchitecte.com' });
  assert.equal(r.json.spf.state, 'info');
  assert.equal(never.asked.length, 0, 'the demo never asks the network');
  const g = (await d.get('/api/v1/ionos')).json;
  assert.equal(g.demo, true);
  assert.equal(g.mail.state, 'none');
});
