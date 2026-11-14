// @ts-check
// Réglages › Connexion IONOS (http/routes-channels.js): the salon keeps its domain and its mailbox at IONOS. What this
// module knows, read on the official pages on 14 November 2026 (docs/messages-whatsapp.md lists them):
// - the outgoing server: smtp.ionos.fr (ionos.fr, « Tester l’accessibilité des serveurs de messagerie »), port 465 in
//   SSL/TLS, or 587 with STARTTLS when 465 is blocked; the user name is the full address, the password the mailbox's own;
//   since 29 January 2024 a different sender address is accepted only on the same domain (ionos.com, « IONOS Mail: Server
//   details for IMAP, POP3, and SMTP »);
// - a mailbox sends 50 messages an hour its first week, 100 up to 14 days, 400 up to 30 days, then 500; past that the server
//   answers « 450 Mail send limit exceeded » (ionos.com, « What restrictions apply to sending bulk emails »);
// - SPF and DKIM are on by default for a domain whose DNS stays at IONOS; elsewhere the SPF is
//   « v=spf1 include:_spf-eu.ionos.com ~all » (ionos.co.uk) and DKIM is three CNAME records, s1-ionos._domainkey →
//   s1.dkim.ionos.com and s2-ionos._domainkey → s2.dkim.ionos.com among them (ionos.co.uk, « Email Authentication with DKIM »).
// Nothing here sends anything, nor ever returns a password or the mailbox's user name: only whether each variable is set,
// the values that are no secret (the server, the port, the sender) and the domain of the user name.
import dns from 'node:dns';
import { parseFrom } from './email.js';

export const IONOS_SMTP = { host: 'smtp.ionos.fr', port: '465', alt: '587' };
export const IONOS_SPF = 'v=spf1 include:_spf-eu.ionos.com ~all';
export const IONOS_SPF_INCLUDE = 'include:_spf-eu.ionos.com';
export const IONOS_DKIM = [{ name: 's1-ionos._domainkey', target: 's1.dkim.ionos.com' }, { name: 's2-ionos._domainkey', target: 's2.dkim.ionos.com' }];
/** The hourly ceiling of a mailbox older than 30 days, and of its first week. */
export const IONOS_LIMIT = { hour: 500, firstWeek: 50 };

/** IONOS's own outgoing servers, whatever the country (smtp.ionos.fr, .com, .de, .co.uk, .es, .it…). */
const IONOS_HOST = /^smtp\.ionos\.(fr|com|de|co\.uk|es|it|at|ca|mx)$/i;
/** The SPF include of IONOS's mail servers: the European and American names, and the older 1&1 ones. */
const IONOS_INCLUDE = /\binclude:(_spf(-eu|-us)?\.ionos\.[a-z.]+|_spf\.perfora\.net|_spf\.kundenserver\.de)\b/i;
const EMAIL = /^[^@\s]{1,64}@([^@\s]{1,190}\.[^@\s]{2,})$/;
const domainOfAddress = (v) => { const m = EMAIL.exec(String(v || '').trim().toLowerCase()); return m ? m[1] : ''; };

/**
 * The mail variables as the deployment has them, read once with the rest of the configuration (http/runtime.js): the server,
 * the port and the two addresses as they are (no secret), the user name only by its domain, the password only as « set ».
 * @param {Record<string, string | undefined>} env
 */
export function mailEnvOf(env) {
  const user = String(env.SMTP_USER || '').trim();
  return {
    host: String(env.SMTP_HOST || '').trim(), port: String(env.SMTP_PORT || '').trim(),
    user: !!user, userIsAddress: !!domainOfAddress(user), userDomain: domainOfAddress(user),
    pass: !!env.SMTP_PASS, from: String(env.EMAIL_FROM || '').trim(), replyTo: String(env.EMAIL_REPLY_TO || '').trim(),
    brevo: !!env.BREVO_API_KEY
  };
}

/**
 * Each variable of the salon's mailbox, set or missing, with what is wrong in plain words. `value`: shown only for what is no
 * secret. `ok` false: it stops the e-mails (missing or wrong); `note`: a doubt that stops nothing.
 * @param {ReturnType<typeof mailEnvOf>} e @param {string} domain the salon's domain, '' when unknown
 */
export function mailVars(e, domain = '') {
  const from = parseFrom(e.from);
  const fromDomain = from ? domainOfAddress(from.email) : '';
  const port = e.port || '';
  /** @type {{ key: string, set: boolean, value: string, ok: boolean, note: string, secret?: boolean }[]} */
  const out = [];
  out.push({ key: 'SMTP_HOST', set: !!e.host, value: e.host, ok: !!e.host, note: !e.host ? '' : IONOS_HOST.test(e.host) ? '' : 'Ce n’est pas un serveur IONOS : pour la boîte du salon, c’est ' + IONOS_SMTP.host + '.' });
  out.push({ key: 'SMTP_PORT', set: !!port, value: port || '465 (par défaut)', ok: !port || port === '465' || port === '587',
    note: !port ? 'Facultatif : 465 si rien n’est mis.' : port === '25' ? 'Le port 25 est fermé chez Vercel : mets 465.' : port === '465' || port === '587' ? '' : 'IONOS attend 465 (ou 587).' });
  out.push({ key: 'SMTP_USER', set: e.user, value: e.userDomain ? '…@' + e.userDomain : '', ok: e.user && e.userIsAddress, secret: true,
    note: e.user && !e.userIsAddress ? 'Ce doit être l’adresse complète de la boîte, par exemple rdv@' + (domain || 'ton-domaine.fr') + '.' : '' });
  out.push({ key: 'SMTP_PASS', set: e.pass, value: '', ok: e.pass, note: '', secret: true });
  out.push({ key: 'EMAIL_FROM', set: !!e.from, value: from ? (from.name ? from.name + ' <' + from.email + '>' : from.email) : e.from, ok: !!from,
    note: e.from && !from ? 'Ce n’est pas une adresse e-mail valide.'
      : from && e.userDomain && fromDomain !== e.userDomain ? 'Pas le même domaine que la boîte (SMTP_USER) : IONOS refuse l’envoi.'
        : from && domain && fromDomain !== domain ? 'Ce n’est pas une adresse de ' + domain + '.' : '' });
  const reply = parseFrom(e.replyTo);
  out.push({ key: 'EMAIL_REPLY_TO', set: !!e.replyTo, value: reply ? reply.email : e.replyTo, ok: !e.replyTo || !!reply, note: !e.replyTo ? 'Facultatif : l’adresse où arrivent les réponses des clients.' : reply ? '' : 'Ce n’est pas une adresse e-mail valide.' });
  return out;
}

/**
 * What to type in Vercel for the salon's mailbox: the IONOS server, its port, the mailbox's full address (the sender's when it
 * is already set on the salon's domain, else rdv@ the domain) and the sender with the salon's name.
 * @param {ReturnType<typeof mailEnvOf>} e @param {string} domain @param {string} shopName
 */
export function mailExpected(e, domain, shopName) {
  const from = parseFrom(e.from);
  const address = from && (!domain || domainOfAddress(from.email) === domain) ? from.email : domain ? 'rdv@' + domain : '';
  const name = String(shopName || '').replace(/[<>"\r\n]+/g, '').trim();
  return { host: IONOS_SMTP.host, port: IONOS_SMTP.port, alt: IONOS_SMTP.alt, user: address, from: address ? (name ? name + ' <' + address + '>' : address) : '' };
}

/**
 * Why an e-mail did not leave, for the owner: what happened in plain words and what to do. Reads the SMTP error's stage, code and
 * kind (messaging/smtp.js), else its words (an outbox row keeps only those). o.port: SMTP_PORT as set, so a port that does not
 * answer is met with the other one.
 * @param {any} err an SmtpError, an Error or the words of one @param {{ port?: string }} [o]
 * @returns {{ kind: string, title: string, hint: string }}
 */
export function mailTrouble(err, o = {}) {
  const msg = String((err && typeof err === 'object' ? err.message : err) || '');
  const stage = err && typeof err === 'object' ? err.stage || '' : '';
  const code = err && typeof err === 'object' ? Number(err.code) || 0 : Number((/\b(4\d\d|5\d\d)\b/.exec(msg) || [])[1]) || 0;
  const why = err && typeof err === 'object' ? err.why || '' : '';
  const is = (re) => re.test(msg);
  if (stage === 'auth' || is(/Identifiant ou mot de passe refusé/)) return { kind: 'password', title: 'Mot de passe refusé par IONOS', hint: 'Vérifie SMTP_USER (l’adresse complète de la boîte) et SMTP_PASS (le mot de passe de cette boîte, pas celui du compte IONOS), puis redéploie.' };
  if (code === 450 || code === 451 || code === 452 || code === 421 || is(/limite les envois|send limit/i)) return { kind: 'limit', title: 'IONOS limite les envois pour l’instant', hint: 'Une boîte IONOS envoie ' + IONOS_LIMIT.hour + ' e-mails par heure au plus (' + IONOS_LIMIT.firstWeek + ' la première semaine). Réessaie dans une heure.' };
  if (stage === 'from' || is(/Expéditeur refusé/)) return { kind: 'sender', title: 'Expéditeur refusé', hint: 'EMAIL_FROM doit être une adresse du même domaine que la boîte (SMTP_USER) : IONOS refuse les autres depuis le 29 janvier 2024.' };
  if (why === 'notfound' || is(/introuvable/)) return { kind: 'host', title: 'Serveur d’e-mail introuvable', hint: 'SMTP_HOST doit être ' + IONOS_SMTP.host + ', sans https:// ni espace.' };
  if (why === 'cert' || is(/Certificat/)) return { kind: 'cert', title: 'Certificat du serveur refusé', hint: 'SMTP_HOST doit être le nom exact du serveur (' + IONOS_SMTP.host + '), pas une adresse IP.' };
  if (why === 'timeout' || why === 'refused' || is(/ne répond pas à temps|Connexion refusée/)) {
    const port = String(o.port || '');
    const next = port === IONOS_SMTP.alt ? 'Mets SMTP_PORT=' + IONOS_SMTP.port + '.' : !port || port === IONOS_SMTP.port ? 'Essaie SMTP_PORT=' + IONOS_SMTP.alt + ' (STARTTLS).' : 'Mets SMTP_PORT=' + IONOS_SMTP.port + ' ; si ça ne passe toujours pas, ' + IONOS_SMTP.alt + '.';
    return { kind: 'port', title: 'Le serveur ne répond pas sur ce port', hint: next + ' Vérifie aussi SMTP_HOST=' + IONOS_SMTP.host + ', puis redéploie.' };
  }
  if (stage === 'starttls' || is(/STARTTLS|non chiffrée/)) return { kind: 'tls', title: 'Connexion chiffrée impossible', hint: 'Mets SMTP_PORT=' + IONOS_SMTP.port + ' : la connexion est chiffrée dès le départ.' };
  if (stage === 'to' || is(/Destinataire refusé/)) return { kind: 'recipient', title: 'Ton adresse a été refusée', hint: 'Vérifie ton e-mail dans Réglages › Messages › Me prévenir.' };
  if (stage === 'config' || is(/manquant|Le port 25/)) return { kind: 'config', title: 'Réglage incomplet', hint: msg };
  if (is(/Brevo/)) return { kind: 'brevo', title: 'Refusé par Brevo', hint: msg };
  return { kind: 'other', title: 'Refusé par le serveur d’e-mail', hint: msg ? 'Ses mots : ' + msg.replace(/^Refusé : /, '') : 'Réessaie dans quelques minutes.' };
}

const CHECK_MS = 6000;
/** A promise that gives up after ms. */
function within(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(Object.assign(new Error('délai dépassé'), { code: 'ETIMEOUT' })), ms); })]).finally(() => clearTimeout(timer));
}
const noRecord = (e) => !!e && (e.code === 'ENODATA' || e.code === 'ENOTFOUND');
const said = (e) => String((e && e.message) || e).slice(0, 120);

/**
 * SPF and DKIM of the salon's domain, read from its public DNS (TXT, CNAME): whether the receiving servers can tell that the
 * salon's e-mails really come from IONOS. A help, never a gate: nothing is blocked on it. `resolve`: the resolver (tests give
 * their own; rt.dnsResolve, as the Jour J card).
 * @param {(host: string, type: string) => Promise<any>} resolve @param {string} domain
 * @returns {Promise<{ spf: { state: 'ok'|'todo'|'warn', line: string, add?: string }, dkim: { state: 'ok'|'todo'|'warn', line: string } }>}
 */
export async function mailDns(resolve, domain) {
  const ask = (h, t) => within(Promise.resolve().then(() => resolve(h, t)), CHECK_MS);
  const txt = (v) => [].concat(v || []).map((x) => (Array.isArray(x) ? x.join('') : String(x)));
  const [spfR, ...dk] = await Promise.allSettled([ask(domain, 'TXT'), ...IONOS_DKIM.map((k) => ask(k.name + '.' + domain, 'CNAME')), ...IONOS_DKIM.map((k) => ask(k.name + '.' + domain, 'TXT'))]);

  /** @type {{ state: 'ok'|'todo'|'warn', line: string, add?: string }} */
  let spf;
  if (spfR.status === 'rejected' && !noRecord(spfR.reason)) spf = { state: 'warn', line: 'Vérification impossible : ' + said(spfR.reason) + '.' };
  else {
    const all = spfR.status === 'fulfilled' ? txt(spfR.value).filter((x) => /^v=spf1\b/i.test(x.trim())) : [];
    if (!all.length) spf = { state: 'todo', line: 'SPF absent : les e-mails du salon risquent d’arriver dans les indésirables. Chez IONOS, Domaines › DNS › Ajouter un enregistrement › IONOS SPF (TXT).', add: IONOS_SPF };
    else if (all.length > 1) spf = { state: 'warn', line: 'Deux enregistrements SPF : un seul doit rester. Garde celui d’IONOS et ajoute-y ce qui manque.' };
    else if (IONOS_INCLUDE.test(all[0])) spf = { state: 'ok', line: 'SPF trouvé et inclut IONOS.' };
    else spf = { state: 'todo', line: 'SPF trouvé mais il n’inclut pas IONOS : ajoute ' + IONOS_SPF_INCLUDE + ' dans la même ligne, avant ~all.', add: IONOS_SPF_INCLUDE };
  }

  const cnames = dk.slice(0, IONOS_DKIM.length), txts = dk.slice(IONOS_DKIM.length);
  const found = IONOS_DKIM.filter((k, i) => {
    const c = cnames[i], t = txts[i];
    return (c.status === 'fulfilled' && [].concat(c.value).some((v) => /\.dkim\.ionos\.[a-z.]+\.?$/i.test(String(v))))
      || (t.status === 'fulfilled' && txt(t.value).some((v) => /v=DKIM1/i.test(v)));
  });
  const errs = dk.filter((x) => x.status === 'rejected' && !noRecord(x.reason));
  /** @type {{ state: 'ok'|'todo'|'warn', line: string }} */
  const dkim = found.length ? { state: 'ok', line: 'DKIM d’IONOS trouvé (' + found.map((k) => k.name).join(', ') + ').' }
    : errs.length === dk.length ? { state: 'warn', line: 'Vérification impossible : ' + said(/** @type {PromiseRejectedResult} */ (errs[0]).reason) + '.' }
      : { state: 'todo', line: 'DKIM d’IONOS pas trouvé. Il est actif par défaut quand les DNS sont chez IONOS ; s’il manque, ajoute chez IONOS les CNAME ' + IONOS_DKIM.map((k) => k.name + ' → ' + k.target).join(' et ') + '.' };
  return { spf, dkim };
}

/** The resolver of the deployment, or the one a test gives (rt.dnsResolve). */
export const resolverOf = (rt) => rt.dnsResolve || ((h, t) => dns.promises.resolve(h, t));
