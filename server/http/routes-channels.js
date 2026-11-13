// @ts-check
// MSG-02 · Réglages › Messages › Messages aux clients: which way the texts leave (WhatsApp by hand from the salon's
// phone, WhatsApp automatic through Meta, SMS by Brevo or the salon's own phone), whether each route is configured (read
// from the environment: never a key, a password or a username in the answer), what is missing in plain words, a test
// to the owner's own phone or mailbox per route, and the WhatsApp templates to create at Meta.
// The tests change nothing in the journal, like the test SMS of Mise en route.
// Also the Messages screen of the Comptoir (« mode téléphone », messaging/hand.js): the queue of texts a person sends
// from WhatsApp, one tap each, and the record that it was done.
import { HttpError, guard } from './kit.js';
import { TEMPLATES, classOf } from '../core/templates.js';
import { waVarNames, waMode, salonWhatsapp } from '../settings/messages.js';
import { phoneAllowed, renderTemplate, whenWords, waMapping } from '../domain/messages.js';
import { ownerEmail } from '../domain/mails.js';
import { normPhone, maskPhone, fmtPhone, isEmail, maskEmail } from '../lib/util.js';
import { WA_TEMPLATES, waDefaults } from '../messaging/whatsapp.js';
import { byHand, effectiveMode, handCount, handQueue } from '../messaging/hand.js';
import { handSent } from '../commands/messages.js';
import { cutoverHold } from '../projections/bascule.js';

const HOUR = 3600000;
export const TEST_PER_HOUR = 3;
export const ROUTES = /** @type {const} */ (['brevo', 'gateway', 'twilio', 'whatsapp']);
/** Who the queue is built for: his rights, and himself (a barber only gets the clients of his own appointments). */
const whoOf = (r) => ({ caps: r.caps, staffId: r.me.id });
/** The menu's Messages entry (http/routes-staff.js badges): how many texts wait for this person, and whether the salon
 *  sends by hand at all (handOn: the page then stays in the menu even when nothing waits). */
export const handBadge = (r) => (r.caps.has('agenda.own') ? { hand: handCount(r.s, r.rt, r.now, r.local, whoOf(r)), handOn: effectiveMode(r.s, r.rt) === 'phone' } : { hand: 0, handOn: false });
/** The owner's words for each route, in the test text too. */
const NAMES = { brevo: 'Brevo', gateway: 'le téléphone du salon', twilio: 'Twilio', whatsapp: 'WhatsApp' };

/** The variables of a text, in the order its default words use them: the order a WhatsApp template is likely to follow. */
const varsOf = (t) => [...new Set([...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

/** The last text that failed, or left by SMS because WhatsApp refused it: what the owner checks first. */
export function lastSmsTrouble(msgs) {
  let failed = null, fallback = null;
  for (const m of msgs) {
    if (m.channel === 'email') continue;
    const at = m.updatedAt || m.at;
    if (m.status === 'failed' && (!failed || at > failed.at)) failed = { at, error: m.error || '', via: m.via || 'sms' };
    if (m.fallback && (!fallback || at > fallback.at)) fallback = { at, error: m.fallback };
  }
  return { lastFailure: failed, lastFallback: fallback };
}

/** @param {any} app */
export function channelRoutes(app) {
  app.get('/api/v1/messages/channels', (r) => {
    const rt = r.rt, s = r.s, cfg = rt.cfg;
    const demo = s.mode === 'demo';
    const routes = cfg.smsRoutes || {};
    const w = s.settings.messages.whatsapp || { enabled: false, templates: {} };
    // the mapping as it would be read with the automatic mode on, whatever the mode chosen today
    const all = { whatsapp: { mode: 'auto', templates: w.templates || {} } };
    let host = '';
    try { host = routes.gateway ? new URL(routes.gateway.url).host : ''; } catch { /* not a URL */ }
    const trouble = lastSmsTrouble([...s.messages.values()]);
    return {
      mode: s.mode,
      // the SMS route in use: SMS_PROVIDER, once its credentials are there
      active: rt.sms ? rt.sms.name : null,
      routes: [
        { key: 'brevo', configured: !!routes.brevo, active: !!rt.sms && rt.sms.name === 'brevo', sender: routes.brevo ? String(routes.brevo.sender).slice(0, 11) : '' },
        // the address only, for a private server: the username and the password stay in Vercel
        { key: 'gateway', configured: !!routes.gateway, active: !!rt.sms && rt.sms.name === 'gateway', host },
        ...(routes.twilio || (rt.sms && rt.sms.name === 'twilio') ? [{ key: 'twilio', configured: !!routes.twilio, active: !!rt.sms && rt.sms.name === 'twilio' }] : [])
      ],
      // the sender is the salon's public WhatsApp Business number: shown, it is no secret
      whatsapp: {
        configured: !!cfg.whatsapp, live: !!rt.whatsapp, enabled: waMode(s.settings.messages) === 'auto', sender: cfg.whatsapp && cfg.whatsapp.senderNumber ? fmtPhone(cfg.whatsapp.senderNumber) : '', senderInvalid: !!cfg.whatsappSenderInvalid,
        // the way chosen, the way texts really leave now (the automatic mode without its token comes down to the phone),
        // one of Meta's two variables without the other, and the salon's own number for the site's button
        mode: waMode(s.settings.messages), effective: effectiveMode(s, rt), incomplete: !!cfg.whatsappIncomplete,
        number: salonWhatsapp(s.settings.messages) ? fmtPhone('+' + salonWhatsapp(s.settings.messages)) : '',
        // the texts waiting for a person now, and whether the switch from WordPress still holds every text to a client
        waiting: handCount(s, rt, r.now, r.local, whoOf(r)), hold: cutoverHold(s)
      },
      // the four templates to create at Meta, word for word, and the mapping Réglages saves with the automatic mode
      metaTemplates: Object.entries(WA_TEMPLATES).map(([k, t]) => ({ key: k, name: t.name, lang: t.lang, text: t.text, params: t.params, mapped: !!waMapping(all, k) })),
      waDefaults: waDefaults(),
      // utility: a service text, which may go by WhatsApp; sms: a review request or an offer, SMS only (FID-01)
      templates: Object.keys(TEMPLATES).map((k) => ({ key: k, category: classOf(k) === 'service' ? 'utility' : 'sms', vars: varsOf(TEMPLATES[k]), mapped: !!waMapping(all, k) })),
      vars: waVarNames(),
      // e-mail: the provider in use (the salon's own mailbox over SMTP, or Brevo), the sender's address and the server's
      // name; never the user name nor the password
      email: {
        provider: rt.email ? rt.email.name : null, configured: !!cfg.email, kind: cfg.email ? cfg.email.kind : null, from: cfg.email ? cfg.email.from : '',
        host: cfg.email && cfg.email.kind === 'smtp' ? String(cfg.email.host) + ':' + cfg.email.port : '', incomplete: !!cfg.smtpIncomplete, fromInvalid: !!cfg.emailFromInvalid,
        to: maskEmail(ownerEmail(s) || '', { domain: false })
      },
      ...trouble,
      demo
    };
  }, { cap: 'settings' });

  /** One e-mail through the provider in use to the owner's own address (« Me prévenir », else his account's). */
  app.post('/api/v1/messages/channels/test-email', async (r) => {
    const s = r.s, rt = r.rt;
    const to = ownerEmail(s) || (r.me && r.me.email) || '';
    if (!isEmail(to)) throw new HttpError(400, 'no_email', 'Indique ton e-mail dans « Me prévenir ».');
    const demo = s.mode === 'demo';
    if (!demo && !rt.email) throw new HttpError(409, 'not_configured', 'Aucun envoi d’e-mail n’est branché : il faut EMAIL_FROM avec SMTP_HOST, SMTP_USER et SMTP_PASS (la boîte du salon), ou avec BREVO_API_KEY.');
    guard('test-email|' + r.me.id, TEST_PER_HOUR, HOUR, 'Trois tests par heure au plus. Réessaie plus tard.');
    const out = { ok: true, to: maskEmail(to, { domain: false }), provider: rt.email ? rt.email.name : null };
    if (demo) return { ...out, simulated: true };
    const text = ['Bonjour,', '', 'Ceci est un test du Comptoir : les e-mails de ' + s.settings.shop.name + ' partent bien' + (rt.email.name === 'smtp' ? ' par la boîte du salon.' : ' par ' + rt.email.name + '.'), 'Les confirmations et les rappels de tes clients suivront le même chemin.', '', s.settings.shop.name].join('\n');
    try {
      const res = await rt.email.send({ to, subject: 'Test du Comptoir : les e-mails partent bien', text, fromName: s.settings.shop.name, tag: 'test' });
      return { ...out, simulated: false, ref: res.ref };
    } catch (err) { throw new HttpError(502, 'send_failed', 'Refusé : ' + String(err && err.message || err)); }
  }, { cap: 'settings' });

  /** « Mode téléphone »: the texts this person sends from WhatsApp now, and who is left out and why. */
  app.get('/api/v1/messages/hand', (r) => {
    const s = r.s;
    const q = handQueue(s, r.rt, r.now, r.local, whoOf(r));
    return { ...q, mode: waMode(s.settings.messages), effective: effectiveMode(s, r.rt), hold: cutoverHold(s), all: r.caps.has('agenda.edit'), demo: s.mode === 'demo' };
  }, { cap: 'agenda.own' });

  /** « Envoyé » (or « Écarter », skip): recorded once, by a journaled command that checks the rights again. */
  app.post('/api/v1/messages/hand/:id/sent', (r) => {
    const m = r.s.messages.get(r.params.id);
    // a text an automatic way is about to take is not a person's to mark (the scheduler would send it a second time)
    if (m && m.status === 'queued' && !byHand(r.s, r.rt, m)) throw new HttpError(409, 'automatic', 'Ce message part tout seul : rien à faire.');
    return r.run(handSent, { id: r.params.id, skip: !!(r.body && r.body.skip) });
  }, { cap: 'agenda.own' });

  /** One text through one route to the owner's own phone: the route checked before the salon depends on it. */
  app.post('/api/v1/messages/channels/test', async (r) => {
    const s = r.s, rt = r.rt;
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const route = ROUTES.find((x) => x === b.route);
    if (!route) throw new HttpError(400, 'invalid', 'Canal inconnu.');
    // the number typed, else the owner's alert phone, else the salon's when it is a mobile: a French mobile only, it is
    // the owner's own phone, and the route is no way to text anyone, anywhere (as Mise en route's test SMS)
    const typed = String(b.phone || '').trim();
    const mobile = (p) => /^\+33[67]\d{8}$/.test(p);
    const saved = [s.settings.notify && s.settings.notify.phone, s.settings.shop.phone].map(normPhone).find(mobile) || '';
    const to = typed ? normPhone(typed) : saved;
    if (!to) throw new HttpError(400, 'no_phone', typed ? 'Ce numéro n’est pas valable.' : 'Indique ton numéro de portable.');
    if (!phoneAllowed(to, s.settings.messages.countries)) throw new HttpError(400, 'country', 'Les SMS ne partent pas vers ce pays (Réglages › Messages).');
    if (!mobile(to)) throw new HttpError(400, 'not_mobile', 'Le test part vers un portable français (06 ou 07).');
    const demo = s.mode === 'demo';
    const provider = demo ? null : route === 'whatsapp' ? rt.whatsapp : rt.smsRoute ? rt.smsRoute(route) : null;
    if (!demo && !provider) throw new HttpError(409, 'not_configured', route === 'whatsapp' ? 'WhatsApp automatique n’est pas branché : il faut WHATSAPP_TOKEN et WHATSAPP_PHONE_ID (docs/messages-whatsapp.md).' : 'Ce canal n’est pas branché : ses identifiants manquent dans Vercel.');
    // WhatsApp: a message the salon starts needs an approved template, the one asked or the first one mapped
    const w = s.settings.messages.whatsapp || { templates: {} };
    const all = { whatsapp: { mode: 'auto', templates: w.templates || {} } };
    const tplKey = route !== 'whatsapp' ? '' : waMapping(all, String(b.template || '')) ? String(b.template) : [...Object.keys(TEMPLATES), 'moved'].find((k) => waMapping(all, k)) || '';
    if (route === 'whatsapp' && !tplKey) throw new HttpError(409, 'no_template', 'Choisis d’abord « WhatsApp automatique » et enregistre : les modèles approuvés par Meta y sont associés.');
    guard('test-route|' + route + '|' + r.me.id, TEST_PER_HOUR, HOUR, 'Trois tests par heure au plus sur ce canal. Réessaie plus tard.');
    const body = renderTemplate('Test du Comptoir : les SMS de {salon} partent bien par {route}. Les liens envoyés aux clients ouvrent {site}', { salon: s.settings.shop.name, route: NAMES[route], site: r.meta.siteUrl });
    const out = { ok: true, route, to: maskPhone(to), ...(tplKey ? { template: tplKey } : { body }) };
    if (demo) return { ...out, simulated: true };
    try {
      if (route === 'whatsapp') {
        const t = /** @type {{ name: string, lang?: string, params: string[] }} */ (waMapping(all, tplKey));
        const sample = sampleVars(r);
        const res = await provider.send(to, { name: t.name, lang: t.lang, params: t.params.map((k) => [k, String(sample[k] ?? k)]) });
        return { ...out, simulated: false, ref: res.ref };
      }
      const res = await provider.send(to, body, {});
      return { ...out, simulated: false, ref: res.ref };
    } catch (err) { throw new HttpError(502, 'send_failed', 'Refusé : ' + String(err && err.message || err)); }
  }, { cap: 'settings' });
}

/** Believable values for a test template: the owner's first name, today 10 h, the first barber, the site's links. */
function sampleVars(r) {
  const s = r.s;
  const barber = [...s.staff.values()].find((x) => x.active && x.chair);
  const site = r.meta.siteUrl || '';
  return {
    prenom: String((r.me && r.me.name) || 'Karim').split(' ')[0], ...whenWords(r.local.day, 600), barbier: barber ? barber.name : 'ton barbier',
    prestation: 'Coupe', prix: '30,00 €', salon: s.settings.shop.name, lien: site, avis: s.settings.shop.reviewUrl || site, jours: '34',
    ticket: 'T000001', montant: '30,00 €', suite: '.', acheteur: 'Karim', code: 'TEST-0000', absent: 'JKut', avant: '10 h'
  };
}
