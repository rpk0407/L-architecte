// The salon's own mailbox over SMTP (messaging/smtp.js): the message as it is written (headers, parts, files), and the
// dialogue with a fake server running in this process: TLS on connect, STARTTLS, the certificate checked, the password
// never on a plain socket nor in an error, the refusals in the owner's words, the deadline.
// The server's certificate is made on the spot with openssl (never kept in the repo); without openssl the network
// tests are skipped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMime, dotStuff, encodeWord, isSmtpAddress, smtpSend, SmtpError } from '../../server/messaging/smtp.js';
import { smtpEmail } from '../../server/messaging/email.js';
import { readConfig } from '../../server/http/runtime.js';

const USER = 'rdv@salon.test', PASS = 'S3cret-Mot-De-Passe';
/** A throwaway key and certificate for « localhost », or null without openssl. */
function makeCert() {
  const dir = mkdtempSync(join(tmpdir(), 'lx-smtp-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    return { key: readFileSync(join(dir, 'k.pem'), 'utf8'), cert: readFileSync(join(dir, 'c.pem'), 'utf8') };
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}
const PKI = makeCert();
const net_ = { skip: PKI ? false : 'openssl is not available: no certificate for the fake server' };

const servers = [];
after(() => { for (const s of servers) s.close(); });

/**
 * A fake SMTP server. o.tls: TLS from the first byte (port 465's way); else plain, offering STARTTLS unless o.noStartTls.
 * o.auth: the mechanisms it announces; o.rejectFrom / o.rejectTo / o.busy: refusals; o.mute: it never greets.
 * log: every command line received (plain: before TLS; secure: after), and the message.
 */
function fakeServer(o = {}) {
  const log = { plain: [], secure: [], data: '', conns: 0 };
  const dialogue = (sock, secure, greet) => {
    let buf = '', inData = false, data = '', login = 0, user = '';
    const say = (l) => { if (!sock.destroyed) sock.write(l + '\r\n'); };
    const onLine = (line) => {
      if (inData) { if (line === '.') { inData = false; log.data = data; say('250 2.0.0 Ok: queued as FAKE1'); } else data += line + '\r\n'; return; }
      (secure ? log.secure : log.plain).push(line);
      if (login === 1) { user = Buffer.from(line, 'base64').toString(); login = 2; return say('334 UGFzc3dvcmQ6'); }
      if (login === 2) { login = 0; return say(user === USER && Buffer.from(line, 'base64').toString() === PASS ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid'); }
      const up = line.toUpperCase();
      if (up.startsWith('EHLO')) return sock.write('250-fake.test\r\n' + (!secure && !o.noStartTls ? '250-STARTTLS\r\n' : '') + '250-AUTH ' + (o.auth || 'PLAIN LOGIN') + '\r\n250 8BITMIME\r\n');
      if (up === 'STARTTLS') {
        say('220 2.0.0 Ready to start TLS');
        sock.removeAllListeners('data');
        const sec = new tls.TLSSocket(sock, { isServer: true, key: PKI.key, cert: PKI.cert });
        sec.on('error', () => {});
        return dialogue(sec, true, false);
      }
      if (up.startsWith('AUTH PLAIN')) return say(Buffer.from(line.slice(11), 'base64').toString() === '\0' + USER + '\0' + PASS ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid');
      if (up === 'AUTH LOGIN') { login = 1; return say('334 VXNlcm5hbWU6'); }
      if (up.startsWith('MAIL FROM')) return say(o.busy ? '451 4.7.1 Too many messages, try again later' : o.rejectFrom ? '550 5.7.1 Sender address is not allowed' : '250 2.1.0 Ok');
      if (up.startsWith('RCPT TO')) return say(o.rejectTo ? '550 5.1.1 Mailbox unavailable' : '250 2.1.5 Ok');
      if (up === 'DATA') { inData = true; return say('354 End data with <CR><LF>.<CR><LF>'); }
      if (up === 'QUIT') { say('221 2.0.0 Bye'); return sock.end(); }
      return say('502 5.5.2 Command not recognized');
    };
    sock.on('data', (c) => { buf += c.toString('utf8'); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); onLine(l); } });
    sock.on('error', () => {});
    if (greet && !o.mute) say('220 fake.test ESMTP');
  };
  const onConn = (sock) => { log.conns++; dialogue(sock, !!o.tls, true); };
  const server = o.tls ? tls.createServer({ key: PKI.key, cert: PKI.cert }, onConn) : net.createServer(onConn);
  server.on('tlsClientError', () => {});
  servers.push(server);
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, log })));
}
const cfgOf = (port, x = {}) => ({ host: 'localhost', port, user: USER, pass: PASS, timeoutMs: 3000, tlsOptions: { ca: PKI.cert }, ...x });
const mail = (x = {}) => buildMime({ from: USER, fromName: 'Barber L’Architecte', to: 'karim@exemple.fr', subject: 'Rendez-vous confirmé : jeudi 5 novembre à 10 h', text: 'Bonjour Karim,\n\nC’est noté.\n.une ligne qui commence par un point', now: Date.UTC(2026, 10, 3, 9, 0, 0), ...x });
const noSecret = (e) => { assert.ok(e instanceof SmtpError, String(e)); assert.doesNotMatch(e.message + ' ' + e.stack, new RegExp(PASS + '|' + Buffer.from('\0' + USER + '\0' + PASS).toString('base64'))); return true; };

test('the message: headers on one line each, accents encoded, text and HTML, the calendar file, nothing injected', () => {
  const m = mail({ html: '<p>Bonjour Karim</p>', replyTo: 'contact@salon.test', tag: 'confirmation', attachments: [{ name: 'rendez-vous.ics', type: 'text/calendar; charset=utf-8; method=PUBLISH', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' }] });
  const [head, ...rest] = m.data.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  assert.match(m.id, /^<[0-9a-f]{32}@salon\.test>$/);
  assert.ok(head.includes('Message-ID: ' + m.id));
  assert.match(head, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <rdv@salon\.test>$/m);
  assert.match(head, /^To: karim@exemple\.fr$/m);
  assert.match(head, /^Reply-To: contact@salon\.test$/m);
  assert.match(head, /^Date: Tue, 3 Nov 2026 09:00:00 \+0000$/m);
  assert.match(head, /^MIME-Version: 1\.0$/m);
  assert.match(head, /^Content-Type: multipart\/mixed; boundary="=_lx_[0-9a-f]{24}"$/m);
  // the subject: encoded words that decode back to the words
  const subj = /^Subject: ((?:.|\r\n )*)$/m.exec(head)[1];
  assert.equal(subj.split(/\r\n /).map((w) => Buffer.from(/^=\?UTF-8\?B\?(.*)\?=$/.exec(w)[1], 'base64').toString('utf8')).join(''), 'Rendez-vous confirmé : jeudi 5 novembre à 10 h');
  for (const l of m.data.split('\r\n')) assert.ok(l.length <= 78, 'a line of ' + l.length);
  assert.equal(m.data.includes('\n') && !/[^\r]\n/.test(m.data), true, 'CRLF only');
  // the parts, in base64
  const decoded = [...body.matchAll(/Content-Transfer-Encoding: base64(?:\r\n[^\r\n]+)*\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((x) => Buffer.from(x[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
  assert.deepEqual(decoded, ['Bonjour Karim,\n\nC’est noté.\n.une ligne qui commence par un point', '<p>Bonjour Karim</p>', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR']);
  assert.match(body, /Content-Type: text\/calendar; charset=utf-8; method=PUBLISH\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="rendez-vous\.ics"/);
  // a line break in a value never starts a header, an odd file type or name is made harmless
  const bad = mail({ subject: 'Bonjour\r\nBcc: voleur@exemple.fr', fromName: 'Salon"\r\nX-Evil: 1', tag: 'x\r\ny', attachments: [{ name: '../a\r\nb.ics', type: 'text/html\r\nX: 1', content: 'x' }] });
  assert.doesNotMatch(bad.data, /^Bcc:/m);
  assert.doesNotMatch(bad.data, /^X-Evil:/m);
  assert.doesNotMatch(bad.data, /^X: 1/m);
  assert.match(bad.data, /^Subject: Bonjour Bcc: voleur@exemple\.fr$/m);
  assert.match(bad.data, /Content-Type: application\/octet-stream/);
  assert.match(bad.data, /filename=".._a b\.ics"/);
  // addresses that could carry a command are refused before anything is written
  for (const a of ['karim@exemple.fr>\r\nRCPT TO:<x@y.fr', 'a b@c.fr', '<a@b.fr>', 'a@b', 'a@@b.fr', '', null]) assert.equal(isSmtpAddress(a), false, String(a));
  assert.equal(isSmtpAddress('prenom.nom+tag@sous.domaine.fr'), true);
  assert.throws(() => mail({ to: 'x@y.fr>\r\nDATA' }), (e) => e instanceof SmtpError && /destinataire invalide/.test(e.message));
  assert.throws(() => mail({ from: 'pas une adresse' }), /EMAIL_FROM/);
  assert.equal(encodeWord('Rappel'), 'Rappel');
  assert.equal(dotStuff('a\n.b\r\n..c\n'), 'a\r\n..b\r\n...c\r\n');
});

test('port 465, TLS from the first byte: authenticated, the envelope, the message as written, a leading dot doubled', net_, async () => {
  const s = await fakeServer({ tls: true });
  const m = mail();
  const r = await smtpSend(cfgOf(s.port, { secure: true }), { from: USER, to: 'karim@exemple.fr', data: m.data + '.raw line\r\n' });
  assert.match(r.response, /queued as FAKE1/);
  assert.deepEqual(s.log.plain, []);
  // (QUIT follows; the send does not wait for the server's goodbye)
  assert.deepEqual(s.log.secure.slice(0, 5).map((l) => l.replace(/^(AUTH PLAIN) .*/, '$1 …')), ['EHLO salon.test', 'AUTH PLAIN …', 'MAIL FROM:<rdv@salon.test>', 'RCPT TO:<karim@exemple.fr>', 'DATA']);
  assert.ok(s.log.data.startsWith(m.data), 'the message arrives byte for byte');
  assert.ok(s.log.data.endsWith('..raw line\r\n'), 'a line that starts with a dot is stuffed');
});

test('port 587, STARTTLS: nothing but EHLO and STARTTLS in clear, the password only once encrypted', net_, async () => {
  const s = await fakeServer();
  await smtpSend(cfgOf(s.port), { from: USER, to: 'karim@exemple.fr', data: mail().data });
  assert.deepEqual(s.log.plain, ['EHLO salon.test', 'STARTTLS']);
  assert.equal(s.log.secure[0], 'EHLO salon.test');
  assert.match(s.log.secure[1], /^AUTH PLAIN /);
  assert.match(s.log.data, /^Subject: /m);
  // a server that only knows AUTH LOGIN
  const l = await fakeServer({ auth: 'LOGIN' });
  await smtpSend(cfgOf(l.port), { from: USER, to: 'karim@exemple.fr', data: mail().data });
  assert.deepEqual(l.log.secure.slice(1, 4), ['AUTH LOGIN', Buffer.from(USER).toString('base64'), Buffer.from(PASS).toString('base64')]);
  assert.match(l.log.data, /^Subject: /m);
});

test('no encryption, no send: a server without STARTTLS, a certificate nobody vouches for, a name that does not match', net_, async () => {
  const plain = await fakeServer({ noStartTls: true });
  await assert.rejects(smtpSend(cfgOf(plain.port), { from: USER, to: 'karim@exemple.fr', data: mail().data }), (e) => noSecret(e) && /ne propose pas de connexion chiffrée/.test(e.message));
  assert.deepEqual(plain.log.plain, ['EHLO salon.test'], 'the password never leaves in clear');
  assert.equal(plain.log.data, '');
  // the certificate is checked: this one is self-signed, and no CA is given
  const s = await fakeServer({ tls: true });
  await assert.rejects(smtpSend(cfgOf(s.port, { secure: true, tlsOptions: undefined }), { from: USER, to: 'karim@exemple.fr', data: mail().data }), (e) => noSecret(e) && /Certificat du serveur d’e-mail refusé/.test(e.message));
  assert.deepEqual(s.log.secure, []);
  const st = await fakeServer();
  await assert.rejects(smtpSend(cfgOf(st.port, { tlsOptions: undefined }), { from: USER, to: 'karim@exemple.fr', data: mail().data }), (e) => noSecret(e) && /Certificat/.test(e.message));
  assert.deepEqual(st.log.secure, []);
  // trusted, but for another name
  const other = await fakeServer({ tls: true });
  await assert.rejects(smtpSend(cfgOf(other.port, { secure: true, host: '127.0.0.1' }), { from: USER, to: 'karim@exemple.fr', data: mail().data }), (e) => noSecret(e) && /Certificat/.test(e.message));
  // nobody can switch the check off from the options
  const off = await fakeServer({ tls: true });
  await assert.rejects(smtpSend(cfgOf(off.port, { secure: true, tlsOptions: { rejectUnauthorized: false } }), { from: USER, to: 'karim@exemple.fr', data: mail().data }), /Certificat/);
});

test('the refusals, in the owner’s words, never with the password: wrong password, sender, recipient, busy, silence', net_, async () => {
  const s = await fakeServer();
  const send = (port, cfg = {}, msg = {}) => smtpSend(cfgOf(port, cfg), { from: USER, to: 'karim@exemple.fr', data: mail().data, ...msg });
  let e = await send(s.port, { pass: 'mauvais-' + PASS }).catch((x) => x);
  assert.match(e.message, /^Identifiant ou mot de passe refusé par le serveur d’e-mail : vérifie SMTP_USER \(l’adresse complète\) et SMTP_PASS$/);
  assert.equal(e.code, 535);
  assert.doesNotMatch(e.message + e.stack, /mauvais|S3cret/);
  assert.equal(s.log.data, '');
  e = await send((await fakeServer({ rejectFrom: true })).port).catch((x) => x);
  assert.match(e.message, /^Expéditeur refusé : EMAIL_FROM doit être une adresse de la même boîte ou du même domaine que SMTP_USER \(5\.7\.1 Sender address is not allowed\)$/);
  noSecret(e);
  e = await send((await fakeServer({ rejectTo: true })).port).catch((x) => x);
  assert.match(e.message, /^Destinataire refusé par le serveur d’e-mail/);
  e = await send((await fakeServer({ busy: true })).port).catch((x) => x);
  assert.match(e.message, /occupé ou limite les envois, à réessayer plus tard/);
  assert.equal(e.code, 451);
  // a server that says nothing: the deadline, not a function left hanging
  const t0 = Date.now();
  e = await send((await fakeServer({ mute: true })).port, { timeoutMs: 250 }).catch((x) => x);
  assert.match(e.message, /ne répond pas à temps/);
  assert.ok(Date.now() - t0 < 2000);
  noSecret(e);
  // nobody listening
  const gone = net.createServer(); await new Promise((ok) => gone.listen(0, '127.0.0.1', ok)); const port = gone.address().port; await new Promise((ok) => gone.close(ok));
  e = await send(port).catch((x) => x);
  assert.match(e.message, /Connexion refusée par le serveur d’e-mail : vérifie SMTP_HOST et SMTP_PORT/);
});

test('refused before any connection: port 25, no host, no password, a recipient that is not an address', async () => {
  const data = buildMime({ from: USER, to: 'karim@exemple.fr', subject: 'x', text: 'y' }).data;
  await assert.rejects(smtpSend({ host: 'smtp.salon.test', port: 25, user: USER, pass: PASS }, { from: USER, to: 'karim@exemple.fr', data }), /port 25/);
  await assert.rejects(smtpSend({ host: '', port: 465, user: USER, pass: PASS }, { from: USER, to: 'karim@exemple.fr', data }), /SMTP_HOST/);
  await assert.rejects(smtpSend({ host: 'smtp.salon.test', port: 465, user: USER, pass: '' }, { from: USER, to: 'karim@exemple.fr', data }), /SMTP_USER, SMTP_PASS/);
  await assert.rejects(smtpSend({ host: 'smtp.salon.test', port: 465, user: USER, pass: PASS }, { from: USER, to: 'karim@exemple.fr>\r\nRCPT TO:<x@y.fr', data }), /Adresse e-mail invalide/);
});

test('the e-mail provider on the salon’s mailbox: a confirmation with its button and calendar file, its Message-ID as reference', net_, async () => {
  const s = await fakeServer({ tls: true });
  const p = smtpEmail({ host: 'localhost', port: s.port, secure: true, user: USER, pass: PASS, from: USER, fromName: 'Barber L’Architecte', replyTo: 'contact@salon.test', timeoutMs: 3000, tlsOptions: { ca: PKI.cert } });
  assert.equal(p.name, 'smtp');
  const r = await p.send({ to: 'karim@exemple.fr', subject: 'Rendez-vous confirmé', text: 'Bonjour Karim,\n\nGérer mon rendez-vous : https://salon.test/r/LA-1', cta: { label: 'Gérer mon rendez-vous', url: 'https://salon.test/r/LA-1' }, links: ['https://salon.test/r/LA-1'], attachments: [{ name: 'rendez-vous.ics', type: 'text/calendar; charset=utf-8; method=PUBLISH', content: 'BEGIN:VCALENDAR' }], tag: 'confirmation' });
  assert.match(r.ref, /^<[0-9a-f]{32}@salon\.test>$/);
  assert.ok(s.log.data.includes('Message-ID: ' + r.ref));
  assert.match(s.log.data, /^Reply-To: contact@salon\.test$/m);
  assert.match(s.log.data, /^X-Lx-Message: confirmation$/m);
  assert.match(s.log.data, /Content-Type: text\/html; charset=utf-8/);
  assert.match(s.log.data, /filename="rendez-vous\.ics"/);
  assert.equal(s.log.conns, 1);
  // a refusal comes back as the provider's error, for the outbox
  const no = await fakeServer({ tls: true, rejectFrom: true });
  await assert.rejects(smtpEmail({ host: 'localhost', port: no.port, secure: true, user: USER, pass: PASS, from: USER, timeoutMs: 3000, tlsOptions: { ca: PKI.cert } }).send({ to: 'karim@exemple.fr', subject: 'x', text: 'y' }), /Expéditeur refusé/);
});

test('configuration: the salon’s mailbox when its three SMTP variables are there, Brevo otherwise, never half of one', () => {
  const env = { EMAIL_FROM: 'Barber L’Architecte <rdv@salon.test>', SMTP_HOST: 'smtp.ionos.fr', SMTP_PORT: '587', SMTP_USER: USER, SMTP_PASS: PASS, EMAIL_REPLY_TO: 'contact@salon.test' };
  assert.deepEqual(readConfig(env).email, { kind: 'smtp', host: 'smtp.ionos.fr', port: 587, user: USER, pass: PASS, from: 'rdv@salon.test', fromName: 'Barber L’Architecte', replyTo: 'contact@salon.test' });
  assert.equal(readConfig({ ...env, SMTP_PORT: undefined }).email.port, 465);
  assert.equal(readConfig({ ...env, BREVO_API_KEY: 'k' }).email.kind, 'smtp', 'the salon’s own mailbox first');
  assert.equal(readConfig({ EMAIL_FROM: 'rdv@salon.test', BREVO_API_KEY: 'k' }).email.kind, 'brevo');
  assert.equal(readConfig({ ...env, SMTP_PASS: '' }).email, null);
  assert.ok(readConfig({ ...env, SMTP_PASS: '' }).smtpIncomplete);
  assert.equal(readConfig({ ...env, EMAIL_FROM: '' }).email, null, 'no sender, no mail');
});
