// @ts-check
// Owner tools: team, catalogue, settings, devices, the activity log, integrity proof, exports.
import { HttpError, guard } from './kit.js';
import { staffView, serviceView, productView } from './views.js';
import { verifyChain, publicEvent } from '../core/journal.js';
import { hashSecret, passwordProblem, pinProblem } from '../auth/password.js';
import { report } from '../domain/insights.js';
import { ticketNo, refundNo, closureNo, METHOD_LABEL } from '../domain/cash.js';
import { isDay, dayRange, monthStart } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { fmtPhone, safeEqual } from '../lib/util.js';
import * as T from '../commands/team.js';
import * as K from '../commands/catalog.js';
import * as SH from '../commands/shop.js';
import { buildDemoJournal } from '../domain/seed.js';
import { maybeTick } from './scheduler.js';

/* ---------------- the activity log, in plain French ---------------- */

const LABELS = {
  'shop.initialized': 'Salon créé', 'settings.updated': 'Réglages modifiés', 'staff.added': 'Membre ajouté', 'staff.updated': 'Fiche équipe modifiée',
  'staff.archived': 'Membre désactivé', 'staff.restored': 'Membre réactivé', 'staff.credentials': 'Accès modifiés', 'staff.revoked': 'Sessions fermées',
  'timeoff.added': 'Absence posée', 'timeoff.removed': 'Absence retirée', 'device.enrolled': 'Appareil enregistré', 'device.revoked': 'Appareil retiré',
  'service.added': 'Prestation créée', 'service.updated': 'Prestation modifiée', 'service.archived': 'Prestation retirée', 'product.added': 'Produit créé',
  'product.updated': 'Produit modifié', 'product.archived': 'Produit retiré', 'stock.adjusted': 'Stock ajusté', 'client.added': 'Client créé',
  'client.updated': 'Fiche client modifiée', 'client.merged': 'Fiches fusionnées', 'client.erased': 'Client effacé (RGPD)', 'appt.held': 'Créneau gardé',
  'hold.released': 'Créneau relâché', 'appt.booked': 'Rendez-vous pris', 'appt.moved': 'Rendez-vous déplacé', 'appt.updated': 'Rendez-vous modifié',
  'appt.status': 'Statut du rendez-vous', 'appt.confirmed': 'Rendez-vous confirmé', 'appt.cancelled': 'Rendez-vous annulé', 'block.added': 'Créneau bloqué',
  'block.removed': 'Créneau rouvert', 'queue.added': 'Passage en file', 'queue.updated': 'File mise à jour', 'waitlist.added': 'Liste d’attente',
  'waitlist.updated': 'Liste d’attente mise à jour', 'sale.completed': 'Vente', 'sale.refunded': 'Remboursement', 'payment.created': 'Paiement en ligne demandé',
  'payment.succeeded': 'Paiement en ligne reçu', 'payment.failed': 'Paiement en ligne échoué', 'payment.expired': 'Paiement en ligne expiré', 'payment.refunded': 'Paiement en ligne remboursé',
  'drawer.opened': 'Caisse ouverte', 'drawer.moved': 'Mouvement de caisse', 'drawer.closed': 'Caisse comptée', 'day.closed': 'Clôture journalière',
  'giftcard.issued': 'Carte cadeau émise', 'giftcard.redeemed': 'Carte cadeau utilisée', 'giftcard.voided': 'Carte cadeau annulée', 'pack.sold': 'Abonnement vendu',
  'pack.used': 'Coupe d’abonnement', 'message.queued': 'Message programmé', 'message.updated': 'Message', 'demo.seeded': 'Démo préparée'
};
const STATUS = { arrived: 'arrivé', in_chair: 'au fauteuil', booked: 'remis à venir', no_show: 'absent' };

function summary(s, e) {
  const d = e.data || {};
  switch (e.type) {
    case 'sale.completed': return ticketNo(d.number) + ' · ' + fmtEur(d.totals.due) + ' · ' + d.payments.map((p) => METHOD_LABEL[p.method] || p.method).join(' + ');
    case 'sale.refunded': return refundNo(d.number) + ' · ' + fmtEur(d.amount) + ' sur ' + ticketNo(d.saleNumber) + ' · ' + d.reason;
    case 'day.closed': return closureNo(d.number) + ' · ' + d.day + ' · ' + fmtEur(d.net);
    case 'drawer.opened': return 'Fond de caisse ' + fmtEur(d.float);
    case 'drawer.moved': return fmtEur(d.amount) + ' · ' + d.reason;
    case 'drawer.closed': return 'Compté ' + fmtEur(d.counted) + (d.diff ? ' · écart ' + fmtEur(d.diff) : ' · juste');
    case 'appt.booked': return d.day + ' ' + Math.floor(d.start / 60) + 'h' + String(d.start % 60).padStart(2, '0') + ' · ' + ((s.staff.get(d.staffId) || {}).name || '') + ' · ' + (d.services || []).map((x) => x.name).join(' + ');
    case 'appt.moved': return 'vers ' + d.day + ' ' + Math.floor(d.start / 60) + 'h' + String(d.start % 60).padStart(2, '0');
    case 'appt.status': return STATUS[d.status] || d.status;
    case 'appt.cancelled': return (d.by === 'client' ? 'par le client' : d.by === 'system' ? 'automatique' : 'par le salon') + (d.reason ? ' · ' + d.reason : '');
    case 'stock.adjusted': return (d.name || '') + ' ' + (d.delta > 0 ? '+' : '') + d.delta + ' · ' + d.reason;
    case 'settings.updated': return Object.keys(d.patch || {}).join(', ');
    case 'staff.added': return d.staff ? d.staff.name : '';
    case 'service.updated': case 'product.updated': return Object.keys(d.patch || {}).join(', ');
    case 'payment.succeeded': { const p = s.payments.get(d.id); return p ? fmtEur(p.amount) + ' · ' + p.label : ''; }
    case 'giftcard.issued': return '•••• ' + d.last4 + ' · ' + fmtEur(d.amount);
    case 'client.updated': return (d.fields || []).join(', ');
    default: return '';
  }
}
function actorName(s, a) {
  if (a.t === 'staff') return (s.staff.get(a.id) || {}).name || 'Équipe';
  if (a.t === 'client') return 'Client (site)';
  if (a.t === 'provider') return a.id === 'stripe' ? 'Stripe' : 'Paiement';
  return a.n || 'Automatique';
}

/* ---------------- CSV for the accountant ---------------- */

function csv(rows) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
const eu = (c) => (c / 100).toFixed(2).replace('.', ',');

export function adminRoutes(app) {
  /* team */
  app.get('/api/v1/staff', (r) => ({ items: [...r.s.staff.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffView(x, true)), timeoff: [...r.s.timeoff.values()] }), { cap: 'team' });
  app.post('/api/v1/staff', async (r) => {
    const res = await r.run(T.addStaff, r.body);
    if (r.body.pin) {
      const pb = pinProblem(r.body.pin);
      if (pb) throw new HttpError(400, 'weak', pb);
      await r.run(T.setCredentials, { id: res.id, pinHash: await hashSecret(r.body.pin) });
    }
    return res;
  }, { cap: 'team' });
  app.patch('/api/v1/staff/:id', (r) => r.run(T.updateStaff, { id: r.params.id, patch: r.body }), { cap: 'agenda.own' });
  app.post('/api/v1/staff/:id/archive', (r) => r.run(T.archiveStaff, { id: r.params.id, restore: !!r.body.restore }), { cap: 'team' });
  app.post('/api/v1/staff/:id/pin', async (r) => {
    const pb = pinProblem(r.body.pin);
    if (pb) throw new HttpError(400, 'weak', pb);
    return r.run(T.setCredentials, { id: r.params.id, pinHash: await hashSecret(r.body.pin) });
  }, { cap: 'team' });
  app.post('/api/v1/staff/:id/password', async (r) => {
    const pb = passwordProblem(r.body.password);
    if (pb) throw new HttpError(400, 'weak', pb);
    return r.run(T.setCredentials, { id: r.params.id, pwdHash: await hashSecret(r.body.password) });
  }, { cap: 'team' });
  app.post('/api/v1/staff/:id/revoke', (r) => r.run(T.revokeSessions, { id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/timeoff', (r) => r.run(T.addTimeOff, r.body), { cap: 'agenda.own' });
  app.del('/api/v1/timeoff/:id', (r) => r.run(T.removeTimeOff, { id: r.params.id }), { cap: 'agenda.own' });

  /* catalogue */
  app.get('/api/v1/catalog', (r) => ({
    services: [...r.s.services.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView),
    products: [...r.s.products.values()].map(productView)
  }), { cap: 'sale.create' });
  app.post('/api/v1/services', (r) => r.run(K.addService, r.body), { cap: 'catalog' });
  app.patch('/api/v1/services/:id', (r) => r.run(K.updateService, { id: r.params.id, patch: r.body }), { cap: 'catalog' });
  app.post('/api/v1/services/:id/archive', (r) => r.run(K.archiveService, { id: r.params.id, restore: !!r.body.restore }), { cap: 'catalog' });
  app.post('/api/v1/products', (r) => r.run(K.addProduct, r.body), { cap: 'catalog' });
  app.patch('/api/v1/products/:id', (r) => r.run(K.updateProduct, { id: r.params.id, patch: r.body }), { cap: 'catalog' });
  app.post('/api/v1/products/:id/archive', (r) => r.run(K.archiveProduct, { id: r.params.id, restore: !!r.body.restore }), { cap: 'catalog' });
  app.post('/api/v1/products/:id/stock', (r) => r.run(K.adjustStock, { id: r.params.id, delta: r.body.delta, reason: r.body.reason }), { cap: 'catalog' });

  /* settings and devices */
  app.get('/api/v1/settings', (r) => r.s.settings, { cap: 'settings' });
  app.patch('/api/v1/settings', (r) => r.run(SH.updateSettings, r.body), { cap: 'settings' });
  app.post('/api/v1/settings/closures', (r) => r.run(SH.addClosure, r.body), { cap: 'settings' });
  app.del('/api/v1/settings/closures/:id', (r) => r.run(SH.removeClosure, { id: r.params.id }), { cap: 'settings' });
  app.get('/api/v1/devices', (r) => ({ items: [...r.s.devices.values()].filter((d) => !d.revoked).map((d) => ({ id: d.id, name: d.name, at: d.at, by: (r.s.staff.get(d.by) || {}).name || 'Démo', current: r.device && r.device.id === d.id })) }), { cap: 'devices' });
  app.del('/api/v1/devices/:id', (r) => r.run(T.revokeDevice, { id: r.params.id }), { cap: 'devices' });

  /* the journal */
  app.get('/api/v1/audit', (r) => {
    const s = r.s;
    const before = Number(r.query.get('before')) || Infinity;
    const type = r.query.get('type') || '';
    const actor = r.query.get('actor') || '';
    const limit = Math.min(200, Number(r.query.get('limit')) || 60);
    const hide = new Set(['appt.held', 'hold.released', 'message.updated', 'demo.seeded']);
    const out = [];
    const j = r.rt.engine.journal;
    for (let i = j.length - 1; i >= 0 && out.length < limit; i--) {
      const e = j[i];
      if (e.v >= before || hide.has(e.type)) continue;
      if (type && !e.type.startsWith(type)) continue;
      if (actor && e.actor.id !== actor) continue;
      out.push({ v: e.v, at: e.at, type: e.type, label: LABELS[e.type] || e.type, summary: summary(s, e), actor: actorName(s, e.actor), actorId: e.actor.id, device: e.actor.dev ? (s.devices.get(e.actor.dev) || {}).name || '' : '', hash: e.h.slice(0, 12) });
    }
    return { items: out, head: s.head, version: s.version };
  }, { cap: 'audit' });

  app.get('/api/v1/integrity', (r) => {
    guard('integrity|' + r.me.id, 6, 60000);
    const t0 = Date.now();
    const res = verifyChain(r.rt.engine.journal);
    const closures = [...r.s.closures.values()].sort((a, b) => b.number - a.number).slice(0, 10).map((z) => ({ ref: closureNo(z.number), day: z.day, seal: z.seal, net: z.net }));
    return { ...res, ms: Date.now() - t0, first: r.rt.engine.journal[0] ? r.rt.engine.journal[0].at : null, closures, store: r.rt.store.kind };
  }, { cap: 'audit' });

  /* exports */
  app.get('/api/v1/export', (r) => {
    const s = r.s;
    const kind = r.query.get('kind') || 'sales';
    const from = isDay(r.query.get('from') || '') ? /** @type {string} */ (r.query.get('from')) : monthStart(r.local.day);
    const to = isDay(r.query.get('to') || '') ? /** @type {string} */ (r.query.get('to')) : r.local.day;
    const need = { sales: 'report.shop', vat: 'report.shop', closures: 'closure', clients: 'client.export', journal: 'data', commissions: 'team' }[kind];
    if (!need) throw new HttpError(400, 'invalid', 'Export inconnu.');
    if (!r.caps.has(need)) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès à cet export.');
    let body = '', name = kind + '-' + from + '-' + to, type = 'text/csv; charset=utf-8';
    const days = new Set(dayRange(from, to));
    if (kind === 'sales') {
      const rows = [['Ticket', 'Date', 'Heure', 'Client', 'Ligne', 'Type', 'Qté', 'PU TTC', 'Net TTC', 'TVA %', 'Barbier', 'Paiements', 'Pourboire']];
      for (const x of [...s.sales.values()].filter((x) => days.has(x.day)).sort((a, b) => a.number - b.number)) {
        const c = x.clientId ? s.clients.get(x.clientId) : null;
        const pays = x.payments.map((p) => (METHOD_LABEL[p.method] || p.method) + ' ' + eu(p.amount)).join(' + ');
        const at = new Date(x.at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
        x.lines.forEach((l, i) => rows.push([ticketNo(x.number), x.day, at, c ? c.first + ' ' + c.last : '', l.name, l.kind, l.qty, eu(l.unit), eu(l.net), l.vat / 100, (s.staff.get(l.staffId) || {}).name || '', i === 0 ? pays : '', i === 0 && x.tip ? eu(x.tip.amount) : '']));
      }
      for (const rf of [...s.refunds.values()].filter((x) => days.has(x.day))) rows.push([refundNo(rf.number), rf.day, '', '', 'Avoir sur ' + ticketNo(rf.saleNumber) + ' · ' + rf.reason, 'avoir', 1, eu(-rf.amount), eu(-rf.amount), '', '', METHOD_LABEL[rf.method] || rf.method, '']);
      body = csv(rows);
    } else if (kind === 'vat' || kind === 'closures') {
      const rows = [['Clôture', 'Jour', 'Tickets', 'Premier', 'Dernier', 'CA TTC', 'CA HT', 'TVA', 'Remboursements', 'Net', 'Pourboires', 'Carte', 'Espèces', 'En ligne', 'Carte cadeau', 'Acompte', 'Cartes cadeaux vendues', 'Grand total perpétuel']];
      for (const z of [...s.closures.values()].filter((z) => days.has(z.day)).sort((a, b) => a.number - b.number)) {
        const tax = z.vat.reduce((t, v) => t + v.tax, 0);
        rows.push([closureNo(z.number), z.day, z.tickets, z.first ? ticketNo(z.first) : '', z.last ? ticketNo(z.last) : '', eu(z.revenue), eu(z.revenueHT), eu(tax), eu(z.refunded), eu(z.net), eu(z.tips),
          eu(z.byMethod.card || 0), eu(z.byMethod.cash || 0), eu(z.byMethod.online || 0), eu(z.byMethod.giftcard || 0), eu(z.byMethod.deposit || 0), eu(z.liability), eu(z.grandTotal)]);
      }
      body = csv(rows);
    } else if (kind === 'commissions') {
      const rep = report(s, { from, to, today: r.local.day, now: r.now });
      const rows = [['Barbier', 'CA prestations TTC', 'CA produits TTC', 'Taux prestations %', 'Taux produits %', 'Commission', 'Pourboires', 'Clients', 'Panier moyen']];
      for (const x of rep.staff) rows.push([x.name, eu(x.serviceRevenue), eu(x.productRevenue), x.rates.service / 100, x.rates.product / 100, eu(x.commission), eu(x.tips), x.clients, eu(x.avgTicket)]);
      body = csv(rows);
    } else if (kind === 'clients') {
      const rows = [['Prénom', 'Nom', 'Téléphone', 'E-mail', 'SMS', 'Marketing', 'Créé le', 'Notes']];
      for (const c of [...s.clients.values()].filter((c) => !c.erased && !c.mergedInto)) rows.push([c.first, c.last, fmtPhone(c.phone), c.email, c.sms ? 'oui' : 'non', c.marketing ? 'oui' : 'non', new Date(c.createdAt).toISOString().slice(0, 10), c.notes]);
      body = csv(rows);
      name = 'clients-' + r.local.day;
    } else {
      // the fiscal archive: every event without personal data, verifiable offline with the hashes
      type = 'application/json; charset=utf-8';
      body = JSON.stringify({ shop: s.settings.shop.name, exportedAt: new Date(r.now).toISOString(), head: s.head, version: s.version, events: r.rt.engine.journal.map(publicEvent) });
      name = 'journal-' + r.local.day;
    }
    return new Response(body, { status: 200, headers: { 'content-type': type, 'content-disposition': `attachment; filename="larchitecte-${name}.${type.startsWith('text/csv') ? 'csv' : 'json'}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }, { cap: 'report.own' });

  /* system */
  app.get('/api/v1/system', (r) => ({
    mode: r.s.mode, store: r.rt.store.kind, version: r.s.version, events: r.rt.engine.journal.length, head: r.s.head,
    payments: { provider: r.rt.pay.name, live: !!r.rt.pay.live }, sms: r.rt.sms ? r.rt.sms.name : null, warnings: r.rt.warnings, setupProtected: !!r.rt.cfg.setupToken,
    devices: [...r.s.devices.values()].filter((d) => !d.revoked).length
  }), { cap: 'settings' });

  app.post('/api/v1/demo/reset', async (r) => {
    if (r.s.mode !== 'demo' || r.me.role !== 'owner') throw new HttpError(403, 'forbidden', 'Réservé au gérant, en démo.');
    guard('reset|' + r.ip, 3, 10 * 60000);
    const eng = r.rt.engine;
    await eng.reset();
    await eng.adopt(await buildDemoJournal(eng.clock(), { siteUrl: r.meta.siteUrl }));
    return { ok: true, version: eng.state.version };
  }, { cap: 'settings' });

  /** For platforms with a scheduler (Vercel Pro cron, GitHub Actions, cron-job.org). */
  app.get('/api/cron/tick', async (r) => {
    const auth = r.req.headers.get('authorization') || '';
    if (!r.rt.cfg.cronSecret || !safeEqual(auth, 'Bearer ' + r.rt.cfg.cronSecret)) throw new HttpError(401, 'unauthorized', 'Non autorisé.');
    await maybeTick(r.rt, r.meta, { force: true });
    return { ok: true, version: r.s.version };
  }, { auth: false, csrf: false });
}
