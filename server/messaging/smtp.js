// @ts-check
// A small SMTP submission client, for the mailbox the salon already pays for (IONOS: smtp.ionos.fr, port 465 in TLS, or
// 587 with STARTTLS; the full address as the user name). Written here and not taken from a package: the project ships
// with three dependencies, and submission to one known server is a short, fixed dialogue (EHLO, STARTTLS, AUTH, MAIL,
// RCPT, DATA). What keeps it safe:
// - encryption is not optional: 465 opens in TLS, any other port must offer STARTTLS, and the certificate is checked
//   against the host name (Node's default; no switch turns it off). The password is never sent on a plain socket;
// - addresses and header values are checked or cleaned before they are written: no line break can add a command or a header;
// - one deadline for the whole exchange, so a slow server never holds a serverless function;
// - an error carries the server's code and words, never the password nor the AUTH line.
// On Vercel only port 25 is closed to functions (vercel.com/kb/guide/serverless-functions-and-smtp): 465 and 587 work
// on the Node.js runtime, and the send must be awaited before the answer, which the scheduler does.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const CRLF = '\r\n';
/** One address as SMTP takes it: no space, no angle bracket, no line break. */
const ADDR = /^[^\s<>@"\\,;:()[\]\x00-\x1f\x7f]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
export const isSmtpAddress = (v) => typeof v === 'string' && ADDR.test(v) && v.includes('.', v.indexOf('@'));

export class SmtpError extends Error {
  /** @param {string} message @param {{ code?: number, stage?: string }} [o] */
  constructor(message, o = {}) { super(message); this.name = 'SmtpError'; this.code = o.code || 0; this.stage = o.stage || ''; }
}

/** A header value on one line: line breaks and control characters out (they would start another header). */
const oneLine = (v) => String(v == null ? '' : v).replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').trim();
const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047: a header's words in UTF-8, as =?UTF-8?B?…?= pieces short enough for a 78-character line, cut between characters. */
export function encodeWord(v) {
  const s = oneLine(v);
  if (isAscii(s)) return s;
  const out = [];
  let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 36) { out.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => '=?UTF-8?B?' + Buffer.from(x, 'utf8').toString('base64') + '?=').join(CRLF + ' ');
}

/** `"Barber L'Architecte" <rdv@salon.fr>`, the name quoted or encoded. */
function mailbox(email, name) {
  const n = oneLine(name);
  if (!n) return email;
  return (isAscii(n) ? '"' + n.replace(/["\\]/g, '') + '"' : encodeWord(n)) + ' <' + email + '>';
}

/** An unstructured ASCII header folded under 78 characters at its spaces. */
function fold(name, value) {
  const words = (name + ': ' + value).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > 76) { lines.push(cur); cur = ' ' + w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join(CRLF);
}

const b64 = (buf) => (buf.toString('base64').match(/.{1,76}/g) || []).join(CRLF);
const boundary = () => '=_lx_' + randomBytes(12).toString('hex');
/** A content type as written by the server (text/calendar; charset=utf-8; method=PUBLISH), cleaned. */
const cleanType = (t) => (/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w-]+=[\w."-]+)*$/.test(oneLine(t)) ? oneLine(t) : 'application/octet-stream');
const cleanName = (n) => oneLine(n).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'fichier';

/** RFC 5322 date, in UTC. */
function mailDate(ms) {
  const d = new Date(ms);
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return D[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' +0000';
}

/**
 * The message as it goes after DATA: headers, the text and its HTML twin (multipart/alternative), then the files
 * (multipart/mixed). Every part in base64: accents and long lines never matter. Lines end with CRLF.
 * @param {{ from: string, fromName?: string, to: string, replyTo?: string, subject: string, text: string, html?: string,
 *   attachments?: { name: string, type: string, content: string }[], now?: number, tag?: string }} m
 * @returns {{ data: string, id: string }}
 */
export function buildMime(m) {
  if (!isSmtpAddress(m.from)) throw new SmtpError('Adresse d’expéditeur invalide (EMAIL_FROM)', { stage: 'build' });
  if (!isSmtpAddress(m.to)) throw new SmtpError('Adresse du destinataire invalide', { stage: 'build' });
  const domain = m.from.slice(m.from.indexOf('@') + 1);
  const id = '<' + randomBytes(16).toString('hex') + '@' + domain + '>';
  const head = [
    'From: ' + mailbox(m.from, m.fromName), 'To: ' + m.to,
    ...(m.replyTo && isSmtpAddress(m.replyTo) ? ['Reply-To: ' + m.replyTo] : []),
    isAscii(oneLine(m.subject)) ? fold('Subject', oneLine(m.subject)) : 'Subject: ' + encodeWord(m.subject),
    'Date: ' + mailDate(m.now || Date.now()), 'Message-ID: ' + id, 'MIME-Version: 1.0',
    // an automatic message: mail servers do not answer it with « absent du bureau »
    'Auto-Submitted: auto-generated',
    ...(m.tag && /^[\w-]{1,40}$/.test(m.tag) ? ['X-Lx-Message: ' + m.tag] : [])
  ];
  const part = (type, buf, extra = []) => ['Content-Type: ' + type, 'Content-Transfer-Encoding: base64', ...extra, '', b64(buf)].join(CRLF);
  const alt = boundary();
  const bodies = [part('text/plain; charset=utf-8', Buffer.from(String(m.text || ''), 'utf8')), ...(m.html ? [part('text/html; charset=utf-8', Buffer.from(m.html, 'utf8'))] : [])];
  const altPart = ['Content-Type: multipart/alternative; boundary="' + alt + '"', '', ...bodies.map((b) => '--' + alt + CRLF + b), '--' + alt + '--'].join(CRLF);
  const files = (m.attachments || []).filter((a) => a && typeof a.content === 'string');
  let body = altPart;
  if (files.length) {
    const mix = boundary();
    const atts = files.map((a) => part(cleanType(a.type), Buffer.from(a.content, 'utf8'), ['Content-Disposition: attachment; filename="' + cleanName(a.name) + '"']));
    body = ['Content-Type: multipart/mixed; boundary="' + mix + '"', '', '--' + mix + CRLF + altPart, ...atts.map((b) => '--' + mix + CRLF + b), '--' + mix + '--'].join(CRLF);
  }
  return { data: head.join(CRLF) + CRLF + body + CRLF, id };
}

/** After DATA a line that starts with a dot gets a second one, and the message ends with a dot alone on its line. */
export const dotStuff = (data) => String(data).replace(/\r?\n/g, CRLF).replace(/^\./gm, '..');

/** What the owner reads when the server says no, by stage and code. Never the server's echo of what we sent to AUTH. */
function refusal(stage, code, text) {
  const said = oneLine(text).slice(0, 140);
  if (stage === 'auth') return 'Identifiant ou mot de passe refusé par le serveur d’e-mail : vérifie SMTP_USER (l’adresse complète) et SMTP_PASS';
  if (code === 421 || code === 450 || code === 451 || code === 452) return 'Le serveur d’e-mail est occupé ou limite les envois, à réessayer plus tard (' + said + ')';
  if (stage === 'from') return 'Expéditeur refusé : EMAIL_FROM doit être une adresse de la même boîte ou du même domaine que SMTP_USER (' + said + ')';
  if (stage === 'to') return 'Destinataire refusé par le serveur d’e-mail (' + said + ')';
  return 'Refusé par le serveur d’e-mail (' + (code || '?') + ' ' + said + ')';
}

/**
 * One message through one authenticated, encrypted session.
 * @param {{ host: string, port?: number, user: string, pass: string, secure?: boolean, timeoutMs?: number, helo?: string,
 *   tlsOptions?: import('node:tls').ConnectionOptions }} cfg tlsOptions: for tests only (a local CA); never rejectUnauthorized
 * @param {{ from: string, to: string, data: string }} msg data: the message as buildMime writes it
 * @returns {Promise<{ response: string }>}
 */
export function smtpSend(cfg, msg) {
  const port = Number(cfg.port) || 465;
  const host = String(cfg.host || '');
  // 465 opens in TLS; any other port starts plain and must upgrade (STARTTLS). `secure` forces one or the other (tests)
  const implicit = cfg.secure != null ? !!cfg.secure : port === 465;
  const timeoutMs = cfg.timeoutMs || 10000;
  if (!host || /[\s/]/.test(host)) return Promise.reject(new SmtpError('Serveur d’e-mail manquant (SMTP_HOST)', { stage: 'config' }));
  if (port === 25) return Promise.reject(new SmtpError('Le port 25 ne sert pas à envoyer depuis une application : utilise 465 ou 587 (SMTP_PORT)', { stage: 'config' }));
  if (!isSmtpAddress(msg.from) || !isSmtpAddress(msg.to)) return Promise.reject(new SmtpError('Adresse e-mail invalide', { stage: 'build' }));
  if (!cfg.user || !cfg.pass || /[\r\n\0]/.test(cfg.user + cfg.pass)) return Promise.reject(new SmtpError('Identifiants du serveur d’e-mail manquants (SMTP_USER, SMTP_PASS)', { stage: 'config' }));
  const tlsOpt = { minVersion: /** @type {const} */ ('TLSv1.2'), ...(cfg.tlsOptions || {}), servername: (cfg.tlsOptions && cfg.tlsOptions.servername) || host, rejectUnauthorized: true };
  const helo = cfg.helo || msg.from.slice(msg.from.indexOf('@') + 1);

  return new Promise((resolve, reject) => {
    /** @type {import('node:net').Socket} */
    let sock;
    let buf = '';
    let stage = 'connect';
    let done = false;
    /** @type {{ ok: (r: { code: number, text: string }) => void, no: (e: Error) => void } | null} */
    let waiting = null;
    /** @type {{ code: number, text: string }[]} */
    const ready = [];
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock && sock.destroy(); } catch { /* already closed */ }
      if (err) reject(err); else resolve(val);
    };
    const timer = setTimeout(() => finish(new SmtpError('Le serveur d’e-mail ne répond pas à temps (' + host + ':' + port + ')', { stage })), timeoutMs);
    const onError = (e) => {
      const code = e && e.code;
      // a certificate that does not match, or is not trusted: never sent, and said plainly
      const cert = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|DEPTH_ZERO/i.test(String(code)) || /certificate/i.test(String(e && e.message));
      finish(new SmtpError(cert ? 'Certificat du serveur d’e-mail refusé (' + host + ') : rien n’est envoyé'
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'Serveur d’e-mail introuvable : vérifie SMTP_HOST'
          : code === 'ECONNREFUSED' ? 'Connexion refusée par le serveur d’e-mail : vérifie SMTP_HOST et SMTP_PORT'
            : 'Connexion au serveur d’e-mail interrompue' + (code ? ' (' + code + ')' : ''), { stage }));
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.length > 65536) return finish(new SmtpError('Réponse du serveur d’e-mail illisible', { stage }));
      for (;;) {
        // a reply: lines "250-…" then a last "250 …"
        const m = /^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3})(?: [^\r\n]*)?\r?\n/.exec(buf);
        if (!m) break;
        const text = m[0].replace(/^\d{3}[- ]?/gm, '').trim();
        buf = buf.slice(m[0].length);
        const r = { code: Number(m[1]), text };
        if (waiting) { const w = waiting; waiting = null; w.ok(r); } else ready.push(r);
      }
    };
    const bind = (s) => { sock = s; s.on('data', onData); s.on('error', onError); s.on('close', () => finish(new SmtpError('Le serveur d’e-mail a fermé la connexion', { stage }))); };
    /** @returns {Promise<{ code: number, text: string }>} */
    const reply = () => new Promise((ok, no) => { const r = ready.shift(); if (r) ok(r); else waiting = { ok, no }; });
    /** Write a line (or nothing) and wait for the reply; `want`: the first digit expected. */
    const cmd = async (line, want, st = stage) => {
      stage = st;
      if (line != null) sock.write(line + CRLF);
      const r = await reply();
      if (Math.floor(r.code / 100) !== want) throw new SmtpError(refusal(st, r.code, r.text), { code: r.code, stage: st });
      return r;
    };
    const caps = (r) => r.text.split(/\r?\n/).map((l) => l.trim().toUpperCase());

    const run = async () => {
      await cmd(null, 2, 'greeting');
      let ehlo = await cmd('EHLO ' + helo, 2, 'ehlo');
      if (!implicit) {
        if (!caps(ehlo).includes('STARTTLS')) throw new SmtpError('Le serveur d’e-mail ne propose pas de connexion chiffrée (STARTTLS) : rien n’est envoyé', { stage: 'starttls' });
        await cmd('STARTTLS', 2, 'starttls');
        const plain = sock;
        plain.removeAllListeners('data'); plain.removeAllListeners('close');
        buf = '';
        await new Promise((ok) => { bind(tls.connect({ ...tlsOpt, socket: plain }, () => ok(null))); });
        ehlo = await cmd('EHLO ' + helo, 2, 'ehlo');
      }
      if (!(/** @type {any} */ (sock)).encrypted) throw new SmtpError('Connexion non chiffrée : rien n’est envoyé', { stage: 'starttls' });
      const auth = (caps(ehlo).find((l) => l.startsWith('AUTH ')) || '').split(/\s+/);
      if (auth.includes('PLAIN') || !auth.includes('LOGIN')) {
        await cmd('AUTH PLAIN ' + Buffer.from('\0' + cfg.user + '\0' + cfg.pass, 'utf8').toString('base64'), 2, 'auth');
      } else {
        await cmd('AUTH LOGIN', 3, 'auth');
        await cmd(Buffer.from(cfg.user, 'utf8').toString('base64'), 3, 'auth');
        await cmd(Buffer.from(cfg.pass, 'utf8').toString('base64'), 2, 'auth');
      }
      await cmd('MAIL FROM:<' + msg.from + '>', 2, 'from');
      await cmd('RCPT TO:<' + msg.to + '>', 2, 'to');
      await cmd('DATA', 3, 'data');
      const end = await cmd(dotStuff(msg.data).replace(/(\r\n)?$/, CRLF) + '.', 2, 'data');
      stage = 'quit';
      // the message is taken: a server that hangs up on QUIT changes nothing
      done = true; clearTimeout(timer);
      try { sock.end('QUIT' + CRLF); } catch { /* closed already */ }
      resolve({ response: end.text.slice(0, 200) });
    };

    try {
      bind(implicit ? tls.connect({ ...tlsOpt, host, port }) : net.connect({ host, port }));
    } catch (e) { return finish(e instanceof SmtpError ? e : new SmtpError('Connexion au serveur d’e-mail impossible', { stage })); }
    run().catch((e) => finish(e instanceof SmtpError ? e : new SmtpError('Envoi interrompu', { stage })));
  });
}
