// @ts-check
// Signing in. The owner uses e-mail + password anywhere; on a device enrolled as "poste du salon",
// the team switches with a 4–6 digit PIN. A PIN is useless anywhere else.
import { HttpError, guard, failureGuard, cookie } from './kit.js';
import { signSession, SESSION_COOKIE, DEVICE_COOKIE, HOUR } from '../auth/session.js';
import { hashSecret, verifySecret, verifyDummy, passwordProblem, pinProblem } from '../auth/password.js';
import { capsOf, ROLES } from '../domain/permissions.js';
import { staffView } from './views.js';
import { newToken, sha256, safeEqual } from '../lib/util.js';
import { setCredentials, enrollDevice, revokeSessions } from '../commands/team.js';
import { initialize } from '../commands/setup.js';
import { DEMO } from '../domain/seed.js';
import { isEmail } from '../lib/util.js';
import { backupKey, backupsOf, keyProblem, restoreBackup } from '../core/backup.js';

const DAY = 24 * HOUR;
/** an uploaded backup arrives in parts: the function body limit is 4.5 MB on Vercel */
const PART_MAX = 3 * 1024 * 1024;
const PARTS_MAX = 64;

export function meView(s, staff, device, kind) {
  const caps = capsOf(staff, s.settings);
  return { ...staffView(staff, true), caps: [...caps], device: device ? { id: device.id, name: device.name } : null, session: kind, roleLabel: ROLES[staff.role] };
}

function setSession(r, staff, kind, remember) {
  const now = r.rt.engine.clock();
  const exp = now + (kind === 'pin' ? 12 * HOUR : remember ? 30 * DAY : 12 * HOUR);
  const token = signSession(r.rt.secret, { uid: staff.id, did: r.device ? r.device.id : null, kind, iat: now + 1, exp });
  r.setCookies.push(cookie(SESSION_COOKIE, token, { maxAge: (exp - now) / 1000, secure: r.rt.cfg.secureCookies }));
}

export function authRoutes(app) {
  /** What the sign-in screen needs: who may sign in on this device. */
  app.get('/api/auth/state', (r) => {
    const s = r.s;
    const team = r.device ? [...s.staff.values()].filter((x) => x.active && x.hasPin).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => ({ id: x.id, name: x.name, initials: x.initials, color: x.color, role: x.role, roleLabel: ROLES[x.role] })) : [];
    return {
      mode: s.mode, needsSetup: s.version === 0, shop: { name: s.settings.shop.name },
      device: r.device ? { id: r.device.id, name: r.device.name } : null, team,
      me: r.me ? meView(s, r.me, r.device, r.session && r.session.kind) : null,
      demo: s.mode === 'demo' ? { email: DEMO.email, password: DEMO.password, ownerPin: DEMO.ownerPin, pins: DEMO.pins, giftcard: DEMO.giftcard } : null
    };
  }, { auth: false });

  app.post('/api/auth/login', async (r) => {
    const email = String(r.body.email || '').trim().toLowerCase();
    const password = String(r.body.password || '');
    guard('login|' + r.ip, 10, 60000);
    const acct = failureGuard('login-acct|' + email, 6, 15 * 60000, 'Trop d’essais pour ce compte. Réessaie dans un quart d’heure.');
    const staff = [...r.s.staff.values()].find((x) => x.active && x.email && x.email === email);
    const creds = staff ? r.s.creds.get(staff.id) : null;
    const ok = creds && creds.pwd ? await verifySecret(password, creds.pwd) : await verifyDummy(password);
    if (!ok || !staff) { acct.fail(); throw new HttpError(401, 'bad_login', 'E-mail ou mot de passe incorrect.'); }
    setSession(r, staff, 'pwd', !!r.body.remember);
    return { me: meView(r.s, staff, r.device, 'pwd') };
  }, { auth: false });

  app.post('/api/auth/pin', async (r) => {
    if (!r.device) throw new HttpError(403, 'no_device', 'Ce poste n’est pas enregistré. Le gérant doit d’abord s’y connecter.');
    const staff = r.s.staff.get(String(r.body.staffId || ''));
    guard('pin-dev|' + r.device.id, 30, 5 * 60000);
    const tries = failureGuard('pin|' + r.device.id + '|' + (staff ? staff.id : 'x'), 5, 5 * 60000, 'Trop d’essais. Patiente 5 minutes ou demande au gérant.');
    const creds = staff && staff.active ? r.s.creds.get(staff.id) : null;
    const ok = creds && creds.pin ? await verifySecret(String(r.body.pin || ''), creds.pin) : await verifyDummy(String(r.body.pin || ''));
    if (!ok || !staff) { tries.fail(); throw new HttpError(401, 'bad_pin', 'Code incorrect.'); }
    setSession(r, staff, 'pin', false);
    return { me: meView(r.s, staff, r.device, 'pin') };
  }, { auth: false });

  app.post('/api/auth/logout', (r) => {
    r.setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: r.rt.cfg.secureCookies }));
    return { ok: true };
  }, { auth: false });

  /** Make this browser a "poste du salon": the team can then sign in with their PIN. */
  app.post('/api/auth/device', async (r) => {
    const token = newToken();
    const res = await r.run(enrollDevice, { name: String(r.body.name || 'Poste du salon').slice(0, 40), tokenHash: sha256(token) });
    r.setCookies.push(cookie(DEVICE_COOKIE, token, { maxAge: 400 * 86400, secure: r.rt.cfg.secureCookies }));
    return { id: res.id };
  }, { cap: 'devices' });

  /** Demo only: any browser can become a salon device in one tap. */
  app.post('/api/auth/device/demo', async (r) => {
    if (r.s.mode !== 'demo') throw new HttpError(404, 'not_found', 'Indisponible.');
    guard('demo-dev|' + r.ip, 5, 60000);
    const token = newToken();
    await r.rt.engine.run(enrollDevice, { name: 'Poste démo', tokenHash: sha256(token), demo: true }, { actor: { t: 'system', id: 'demo' }, caps: new Set(['devices']) });
    r.setCookies.push(cookie(DEVICE_COOKIE, token, { maxAge: 30 * 86400, secure: r.rt.cfg.secureCookies }));
    return { ok: true };
  }, { auth: false });

  app.post('/api/auth/forget-device', (r) => {
    r.setCookies.push(cookie(DEVICE_COOKIE, '', { maxAge: 0, secure: r.rt.cfg.secureCookies }));
    r.setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: r.rt.cfg.secureCookies }));
    return { ok: true };
  }, { auth: false });

  app.post('/api/auth/password', async (r) => {
    guard('pw|' + r.me.id, 5, 15 * 60000);
    const creds = r.s.creds.get(r.me.id) || {};
    if (creds.pwd && !(await verifySecret(String(r.body.current || ''), creds.pwd))) throw new HttpError(401, 'bad_login', 'Mot de passe actuel incorrect.');
    const problem = passwordProblem(r.body.next);
    if (problem) throw new HttpError(400, 'weak', problem);
    await r.run(setCredentials, { id: r.me.id, pwdHash: await hashSecret(r.body.next) });
    // sign out everywhere else, keep this browser signed in
    await r.run(revokeSessions, { id: r.me.id });
    setSession(r, r.s.staff.get(r.me.id), r.session.kind, true);
    return { ok: true };
  });

  app.post('/api/auth/pin-change', async (r) => {
    guard('pinc|' + r.me.id, 5, 15 * 60000);
    const creds = r.s.creds.get(r.me.id) || {};
    if (creds.pin && r.session.kind === 'pin' && !(await verifySecret(String(r.body.current || ''), creds.pin))) throw new HttpError(401, 'bad_pin', 'Code actuel incorrect.');
    const problem = pinProblem(r.body.next);
    if (problem) throw new HttpError(400, 'weak', problem);
    await r.run(setCredentials, { id: r.me.id, pinHash: await hashSecret(r.body.next) });
    return { ok: true };
  });

  /* Installing from a backup: only an empty salon, only with SETUP_TOKEN (sent as x-setup-token). */
  const gate = (r) => {
    guard('restore|' + r.ip, 120, 15 * 60000);
    if (r.s.version > 0) throw new HttpError(409, 'initialized', 'Le salon est déjà configuré.');
    if (r.rt.cfg.mode !== 'production') throw new HttpError(409, 'demo', 'La démo est déjà configurée.');
    if (!r.rt.cfg.setupToken) throw new HttpError(403, 'no_token', 'SETUP_TOKEN n’est pas défini : ajoute-le dans les variables d’environnement pour installer le salon.');
    const tries = failureGuard('setup-token|' + r.ip, 8, 15 * 60000, 'Trop d’essais. Réessaie dans un quart d’heure.');
    if (!safeEqual(String(r.req.headers.get('x-setup-token') || ''), r.rt.cfg.setupToken)) { tries.fail(); throw new HttpError(403, 'bad_token', 'Code d’installation incorrect.'); }
  };
  /** @param {string} from the Blob file's name, or 'fichier' for an upload: recorded in the journal (shop.restored) */
  const restore = async (r, text, from) => {
    const res = await restoreBackup(r.rt.engine, text, backupKey(r.rt.cfg.backupKey), { mode: r.rt.cfg.mode, from });
    r.rt.backupState = null;
    return { ok: true, version: res.version };
  };

  /** The backups this installation's Blob store holds (a new deployment pointed at the old store), whatever their salon. */
  app.get('/api/setup/backups', async (r) => {
    gate(r);
    const blob = backupsOf(r.rt);
    const problem = keyProblem(r.rt.cfg.backupKey);
    /** @type {any[]} */
    let items = [];
    let error = '';
    if (blob) { try { items = await blob.listBackups(); } catch (err) { error = 'Lecture des sauvegardes impossible : ' + String(err && err.message || err); } }
    return { blob: !!blob, key: !problem, keyProblem: problem, error, items: items.map(({ name, day, at, count, size }) => ({ name, day, at, count, size })) };
  }, { auth: false });

  app.post('/api/setup/restore', async (r) => {
    gate(r);
    backupKey(r.rt.cfg.backupKey);
    const blob = backupsOf(r.rt);
    if (!blob) throw new HttpError(409, 'backup_blob', 'Aucun stockage Blob n’est relié (BLOB_READ_WRITE_TOKEN) : envoie le fichier de sauvegarde à la place.');
    const f = await blob.getBackup(String(r.body.name || ''));
    if (!f) throw new HttpError(404, 'not_found', 'Sauvegarde introuvable.');
    return restore(r, await f.text(), String(r.body.name));
  }, { auth: false });

  /** A file of one part (almost every backup): a single request, nothing kept between instances. */
  app.post('/api/setup/restore/file', async (r) => {
    gate(r);
    backupKey(r.rt.cfg.backupKey);
    if (!r.raw) throw new HttpError(400, 'invalid', 'Envoi invalide.');
    if (r.raw.length > PART_MAX) throw new HttpError(413, 'too_large', 'Fichier trop volumineux pour un seul envoi : envoie-le en plusieurs parties.');
    return restore(r, r.raw, 'fichier');
  }, { auth: false, raw: true });

  /** A file from the owner's computer, part by part (?i=0..n-1, in order), staged in Blob across instances. */
  app.post('/api/setup/restore/chunk', async (r) => {
    gate(r);
    // say it before the whole upload, not after
    backupKey(r.rt.cfg.backupKey);
    const i = Number(r.query.get('i')), n = Number(r.query.get('n'));
    if (!Number.isInteger(n) || n < 1 || n > PARTS_MAX || !Number.isInteger(i) || i < 0 || i >= n || !r.raw) throw new HttpError(400, 'invalid', 'Envoi invalide.');
    if (r.raw.length > PART_MAX) throw new HttpError(413, 'too_large', 'Partie trop volumineuse (3 Mo au plus).');
    const blob = backupsOf(r.rt);
    // on Vercel, two requests may reach two instances: without Blob, the parts would not meet
    if (!blob && r.rt.cfg.isVercel) throw new HttpError(409, 'backup_blob', 'Ce fichier dépasse 2,5 Mo : pour l’envoyer en plusieurs parties, relie un stockage Blob (BLOB_READ_WRITE_TOKEN) à cette installation, puis recommence.');
    if (blob) { if (i === 0) await blob.clearChunks(); await blob.putChunk(i, n, r.raw); }
    else {
      // no Blob, one server (local, file store): this instance's memory
      if (i === 0 || !r.rt.restoreParts) r.rt.restoreParts = new Map();
      r.rt.restoreParts.set(n + ':' + i, r.raw);
    }
    return { ok: true, i, n };
  }, { auth: false, raw: true });

  app.post('/api/setup/restore/commit', async (r) => {
    gate(r);
    backupKey(r.rt.cfg.backupKey);
    const n = Number(r.body.n);
    if (!Number.isInteger(n) || n < 1 || n > PARTS_MAX) throw new HttpError(400, 'invalid', 'Envoi invalide.');
    const blob = backupsOf(r.rt);
    const mem = r.rt.restoreParts;
    const parts = blob ? null : Array.from({ length: n }, (_, i) => (mem ? mem.get(n + ':' + i) : undefined));
    const text = blob ? await blob.readChunks(n) : parts && parts.every((x) => x != null) ? parts.join('') : null;
    if (text == null) throw new HttpError(409, 'backup_parts', 'Une partie du fichier manque : recommence l’envoi.');
    try { return await restore(r, text, 'fichier'); }
    finally { if (blob) await blob.clearChunks().catch(() => {}); else r.rt.restoreParts = null; }
  }, { auth: false });

  /** First start in production: create the owner. Needs SETUP_TOKEN, so nobody else can claim the salon. */
  app.post('/api/setup', async (r) => {
    guard('setup|' + r.ip, 5, 15 * 60000);
    if (r.s.version > 0) throw new HttpError(409, 'initialized', 'Le salon est déjà configuré.');
    if (r.rt.cfg.mode !== 'production') throw new HttpError(409, 'demo', 'La démo est déjà configurée.');
    if (!r.rt.cfg.setupToken || !safeEqual(String(r.body.token || ''), r.rt.cfg.setupToken)) throw new HttpError(403, 'bad_token', 'Code d’installation incorrect.');
    if (!isEmail(r.body.email)) throw new HttpError(400, 'invalid', 'E-mail invalide.');
    const problem = passwordProblem(r.body.password) || (r.body.pin ? pinProblem(r.body.pin) : null);
    if (problem) throw new HttpError(400, 'weak', problem);
    const res = await r.rt.engine.run(initialize, {
      mode: 'production', owner: { name: String(r.body.name || 'Gérant'), email: String(r.body.email).toLowerCase() },
      pwdHash: await hashSecret(r.body.password), pinHash: r.body.pin ? await hashSecret(r.body.pin) : undefined
    }, { actor: { t: 'system', id: 'setup' }, caps: new Set() });
    setSession(r, r.s.staff.get(res.ownerId), 'pwd', true);
    return { ok: true };
  }, { auth: false });
}
