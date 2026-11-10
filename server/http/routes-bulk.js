// @ts-check
// WP8 · One action on many client files: POST /api/v1/clients/bulk (docs/owner-experience.md, 3.6).
//
//   { op: 'tag' | 'untag' | 'sms' | 'export',
//     ids: [...]                                 the files ticked one by one, BULK_MAX at most
//   | filter: { q?, segment?, sort? }            « everything this filter matches »: resolved HERE, when the action runs,
//     except?: [...], expect?: n                 by the list's own handler; minus the unticked rows; `expect` is the count
//                                                the person confirmed (409 `changed` when it no longer holds)
//     tag?, text?, dry? }
//
// What every operation keeps:
// - rights: those of the single action, checked here before anything is read and again inside each command
//   (tag: client.edit, and agenda.edit for « confiance »; sms: marketing; export: client.export). The filter is read with
//   the caller's own rights (client.view).
// - idempotent: a request retried with the same x-request-id gets its first answer and writes nothing (app.js gives
//   each command of a request its own key; the commands rebuild their answer from the journal on another instance).
// - bounded: BULK_MAX files a request, SMS_MAX texts; over it nothing happens and the message says how many.
// - journalled by the engine like any write: a tag is the single edit's event for each file that changes, all in ONE
//   append (all or nothing); a text is the message queue's own event under its deterministic key (rebook_<file>_<day>);
//   an export writes the technical log's « export » line (who, how many; never whom), and no file leaves without it.
// - consent: a text goes through sendRebook, which this file calls and never rewrites; the files left out are counted
//   by reason. `dry` runs that same command on the state without saving anything: the preview IS what would be sent.
// - an erased or merged file is never written to, texted or exported.
// No new event type, no change to an existing one.
import { HttpError } from './kit.js';
import { fail } from '../core/engine.js';
import { str, arr, id, opt, obj, bool, int, oneOf, parse } from '../lib/validate.js';
import { csv } from '../lib/csv.js';
import { fmtPhone } from '../lib/util.js';
import { BULK_MAX, tagClients, logClientExport } from '../commands/clients.js';
import { sendRebook } from '../commands/messages.js';
import { clientStats } from '../domain/insights.js';

export { BULK_MAX };
/** The most texts one request may queue (a text costs money and cannot be taken back). */
export const SMS_MAX = 500;
/** sendRebook takes 200 files a run: a larger send is several runs, each one write, each with its own idempotency key */
const SMS_RUN = 200;
/** the segments of GET /api/v1/clients: an unknown one would read as « Tous » there, which a bulk action must never guess */
const SEGMENTS = ['all', 'nouveaux', 'fideles', 'relancer', 'absents', 'abonnes', 'vip', 'anniversaires', 'doublons', 'inactifs'];
const SORTS = ['recent', 'name', 'spend', 'visits', 'overdue'];
const NEED = { tag: 'client.edit', untag: 'client.edit', sms: 'marketing', export: 'client.export' };

const schema = obj({
  op: oneOf(/** @type {const} */ (['tag', 'untag', 'sms', 'export'])),
  ids: opt(arr(id(), { min: 1, max: BULK_MAX })),
  filter: opt(obj({ q: opt(str({ max: 80 })), segment: opt(oneOf(SEGMENTS)), sort: opt(oneOf(SORTS)) })),
  except: opt(arr(id(), { max: BULK_MAX })),
  expect: opt(int({ min: 0, max: 1000000 })),
  tag: opt(str({ min: 1, max: 24 })),
  text: opt(str({ min: 10, max: 320 })),
  dry: opt(bool())
});

/** 2 000, with the narrow no-break space French figures take */
const fr = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
const files = (n) => fr(n) + (n > 1 ? ' fiches' : ' fiche');

/**
 * The files a request names, alive now: its ids as sent, or what its filter matches at this instant.
 * `known`: the retry of a request already written (its answer is replayed): the count confirmed then is not checked
 * against the list of now, which the request itself may have changed (« retirer VIP » empties the VIP filter).
 * @returns {{ ids: string[], all: string[], missing: number, by: 'ids'|'filter' }} all: the ids as named, alive or not
 */
function targets(app, r, x, known) {
  const s = r.s;
  const alive = (cid) => { const c = s.clients.get(cid); return !!c && !c.erased && !c.mergedInto; };
  if (x.ids) {
    if (x.except) throw new HttpError(400, 'invalid', 'Les fiches décochées vont avec un filtre, pas avec une liste de fiches.');
    const all = [...new Set(x.ids)];
    const ids = all.filter(alive);
    return { ids, all, missing: all.length - ids.length, by: 'ids' };
  }
  // the list's own handler, asked for the ids of this filter: one definition of every segment and of the search
  const list = app.match('GET', '/api/v1/clients');
  const sub = Object.create(r);
  sub.query = new URLSearchParams({ fields: 'ids', ...(x.filter.q ? { q: x.filter.q } : {}), ...(x.filter.segment ? { segment: x.filter.segment } : {}), ...(x.filter.sort ? { sort: x.filter.sort } : {}) });
  const found = list.route.fn(sub);
  if (found.truncated) throw new HttpError(400, 'too_many', 'Ce filtre correspond à ' + files(found.total) + ' : ' + fr(BULK_MAX) + ' au plus à la fois. Affine le filtre, ou coche les fiches.', { total: found.total, max: BULK_MAX });
  const out = new Set(x.except || []);
  const ids = found.ids.filter((cid) => !out.has(cid) && alive(cid));
  if (!known && x.expect != null && ids.length !== x.expect) throw new HttpError(409, 'changed', 'La liste a changé entre-temps (' + files(ids.length) + '). Vérifie-la avant de recommencer.', { total: ids.length });
  return { ids, all: ids, missing: 0, by: 'filter' };
}

/** A context for a command run on the state without the engine: what it would emit is collected and thrown away. */
function dryCtx(r) {
  const ctx = {
    now: r.now, local: r.local, actor: { t: 'staff', id: r.me.id }, staff: r.me, caps: r.caps, meta: r.meta, drafts: /** @type {any[]} */ ([]),
    emit(type, data, pii) { ctx.drafts.push(pii == null ? { type, data } : { type, data, pii }); },
    id: (p) => p + '_dry', token: () => 'dry', code: () => 'DRY',
    can: (c) => r.caps.has(c),
    need(c) { if (!r.caps.has(c)) fail(403, 'forbidden', 'Tu n’as pas accès à cette action.'); }
  };
  return ctx;
}

/**
 * Why a file gets no text, in the order the person can act on it: no yes to the offers (a STOP is one), no number or
 * texts switched off, seen less than a week ago (or never: nothing to follow up). '' when it may get one. The decision
 * itself stays sendRebook's: this only names the reason of those it leaves out.
 */
function whyNot(c, st) {
  if (!c.marketing) return 'noConsent';
  if (!c.sms || !c.phone) return 'noPhone';
  if (!st || st.sinceLast == null || st.sinceLast < 7) return 'recent';
  return '';
}

/** @param {any} app */
export function bulkRoutes(app) {
  app.post('/api/v1/clients/bulk', async (r) => {
    // said in words before the schema's own « de 1 à 2000 éléments »
    const named = r.body && Array.isArray(r.body.ids) ? r.body.ids.length : 0;
    if (named > BULK_MAX) throw new HttpError(400, 'too_many', fr(BULK_MAX) + ' fiches au plus à la fois (' + fr(named) + ' ici). Affine le filtre, ou fais-le en plusieurs fois.', { total: named, max: BULK_MAX });
    const x = parse(schema, r.body);
    if (!r.caps.has(NEED[x.op]) || (x.tag === 'confiance' && !r.caps.has('agenda.edit'))) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès à cette action.');
    if (!x.ids === !x.filter) throw new HttpError(400, 'invalid', 'Une liste de fiches ou un filtre, l’un des deux.');
    if ((x.op === 'tag' || x.op === 'untag') && !x.tag) throw new HttpError(400, 'invalid', 'Quelle étiquette ?');
    const s = r.s;
    const requestId = r.req.headers.get('x-request-id') || undefined;
    const known = !!requestId && r.rt.engine.knows({ t: 'staff', id: r.me.id }, requestId) === 'answered';
    const t = targets(app, r, x, known);

    if (x.op === 'tag' || x.op === 'untag') {
      // matched: the files named (an erased, merged or unknown one is counted in `missing` by the command itself)
      if (!t.all.length) return { op: x.op, tag: x.tag, matched: 0, changed: 0, unchanged: 0, missing: 0, full: 0, ids: [] };
      const res = await r.run(tagClients, { ids: t.all, tag: x.tag, remove: x.op === 'untag' });
      return { op: x.op, tag: x.tag, matched: res.matched, changed: res.changed, unchanged: res.unchanged, missing: res.missing, full: res.full, ids: res.ids };
    }

    if (x.op === 'sms') {
      const stats = clientStats(s, r.local.day, r.now);
      const excluded = { noConsent: 0, noPhone: 0, recent: 0, other: 0 };
      const may = [];
      for (const cid of t.ids) { const why = whyNot(s.clients.get(cid), stats.get(cid)); if (why) excluded[why]++; else may.push(cid); }
      const runs = [];
      for (let i = 0; i < may.length; i += SMS_RUN) runs.push({ clientIds: may.slice(i, i + SMS_RUN), ...(x.text ? { text: x.text } : {}) });
      // first on the state, unsaved: the exact files that would get a text now (already texted today, a landline, a
      // foreign number or a file never told about the site are left out by the queue itself)
      const would = [];
      let dueAt = 0;
      for (const input of runs) {
        const ctx = dryCtx(r);
        would.push(...sendRebook.run(s, input, ctx).ids);
        for (const d of ctx.drafts) if (d.type === 'message.queued' && d.data.dueAt > dueAt) dueAt = d.data.dueAt;
      }
      const first = would.length ? s.clients.get(would[0]) : null;
      const M = s.settings.messages;
      const base = { op: 'sms', matched: t.ids.length + t.missing, missing: t.missing };
      if (x.dry) {
        return { ...base, dry: true, sent: would.length, excluded: { ...excluded, other: may.length - would.length }, ids: would.slice(0, 3), max: SMS_MAX, template: M.templates.rebook, stop: M.stopSuffix,
          // the first text, for the preview: who it is for, and when it leaves if the quiet hours hold it
          first: first ? { prenom: first.first, jours: stats.get(first.id).sinceLast } : null, dueAt: dueAt > r.now ? dueAt : null };
      }
      if (!known && would.length > SMS_MAX) throw new HttpError(400, 'too_many', fr(would.length) + ' SMS partiraient : ' + SMS_MAX + ' au plus à la fois. Affine le filtre, ou envoie en plusieurs fois.', { total: would.length, max: SMS_MAX });
      const sent = [];
      // each run is one write; a retry of the request replays the runs already written and goes on with the others
      for (const input of runs) { const res = await r.run(sendRebook, input); sent.push(...(res.ids || [])); }
      return { ...base, sent: sent.length, excluded: { ...excluded, other: may.length - sent.length }, ids: sent, dueAt: dueAt > r.now ? dueAt : null };
    }

    // export: the columns of GET /api/v1/export?kind=clients, for these files only; logged first, sent after
    if (!t.ids.length) throw new HttpError(400, 'invalid', 'Aucune fiche à exporter.');
    const f = /** @type {{ q?: string, segment?: string }} */ (x.filter || {});
    await r.run(logClientExport, { count: t.ids.length, by: t.by, ...(t.by === 'filter' && f.segment && f.segment !== 'all' ? { segment: f.segment } : {}), ...(t.by === 'filter' && f.q ? { search: true } : {}) });
    const rows = [['Prénom', 'Nom', 'Téléphone', 'E-mail', 'SMS', 'Marketing', 'Créé le', 'Notes']];
    for (const cid of t.ids) {
      const c = r.s.clients.get(cid);
      if (!c || c.erased || c.mergedInto) continue;
      rows.push([c.first, c.last, fmtPhone(c.phone), c.email, c.sms ? 'oui' : 'non', c.marketing ? 'oui' : 'non', new Date(c.createdAt).toISOString().slice(0, 10), c.notes]);
    }
    return new Response(csv(rows), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="larchitecte-clients-selection-${r.local.day}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-lx-count': String(rows.length - 1) } });
  }, { cap: 'client.view' });
}
