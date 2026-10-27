// @ts-check
// Governance (TEAM-01): what someone other than the owner changed in a colleague's pay or access. updateStaff, addStaff
// and setCredentials (commands/team.js) emit team.changed { staffId, field: 'commission'|'role'|'access', from, to, by }
// next to their own event: from null for a newcomer; for access, to 'pin'|'password' when set, and from 'pin'|'password'
// to null when removed. Here the last 100 are kept in s.teamChanges (TEAM-05's decision queue reads them) and shown in
// the feed to whoever holds `team` only. Ids, rates and role codes only: no personal data.
// Registered in core/extensions.js. No import of the engine or the state here.
import { ROLES } from '../domain/permissions.js';

const KEEP = 100;
const NB = '\u00a0';
/** 4000 basis points → "40", 4250 → "42,5"; pct adds the sign, which never wraps alone onto the next line */
const num = (bp) => String(Math.round((Number(bp) || 0) / 10) / 10).replace('.', ',');
const pct = (bp) => num(bp) + NB + '%';
const move = (a, b) => num(a) + ' → ' + pct(b);
/** « de JKut », « d’Esteban », « du Soldat » */
const of = (name) => (/^le\s/i.test(name) ? 'du ' + name.slice(3) : /^les\s/i.test(name) ? 'des ' + name.slice(4) : /^[aeiouyhàâäéèêëîïôöûùü]/i.test(name) ? 'd’' + name : 'de ' + name);
const role = (r) => (ROLES[r] || r || '').toLowerCase();

/** The feed line for one change: « Frank a changé la commission de JKut : 40 → 45 % ». */
export function changeWords(s, d) {
  const name = (id) => (s.staff.get(id) || {}).name || 'quelqu’un';
  const by = name(d.by), who = name(d.staffId);
  if (d.field === 'access') {
    const what = (d.to || d.from) === 'password' ? 'le mot de passe ' : 'le code ';
    return by + (d.to ? ' a défini ' : ' a retiré ') + what + of(who);
  }
  if (d.field === 'role') return d.from ? by + ' a changé le rôle ' + of(who) + NB + ': ' + role(d.from) + ' → ' + role(d.to) : by + ' a ajouté ' + who + ' comme ' + role(d.to);
  const f = d.from, t = d.to || {};
  if (!f) return by + ' a fixé la commission ' + of(who) + NB + ': ' + pct(t.service) + ' prestations, ' + pct(t.product) + ' produits';
  // the service rate is the one people talk about; a product rate that moves too is named, never left out
  const svc = f.service !== t.service, prd = f.product !== t.product;
  if (svc && prd) return by + ' a changé la commission ' + of(who) + NB + ': prestations ' + move(f.service, t.service) + ', produits ' + move(f.product, t.product);
  if (prd) return by + ' a changé la commission produits ' + of(who) + NB + ': ' + move(f.product, t.product);
  return by + ' a changé la commission ' + of(who) + NB + ': ' + move(f.service, t.service);
}

/** @type {import('../core/extensions.js').Extension} */
export const governanceExtension = {
  init(s) { s.teamChanges = []; },
  on: {
    'team.changed': (s, e, d) => {
      s.teamChanges.push({ id: e.id, v: e.v, at: e.at, staffId: d.staffId, field: d.field, from: d.from ?? null, to: d.to ?? null, by: d.by });
      if (s.teamChanges.length > KEEP) s.teamChanges.splice(0, s.teamChanges.length - KEEP);
    }
  },
  feed: ['team.changed'],
  // staffId null: it must reach only holders of `team`, not the colleague's phone through his own toasts
  item(r, f) {
    const d = f.data || {};
    // one's own change is no news to oneself
    if (!r.caps.has('team') || d.by === r.me.id) return null;
    return { v: f.v, at: f.at, by: f.actor.t, kind: 'team', title: changeWords(r.s, d), sub: d.field === 'access' ? 'Accès de l’équipe' : 'Rémunération et rôles', staffId: null };
  }
};
