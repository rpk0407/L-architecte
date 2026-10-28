// @ts-check
// TEAM-02: each person's own Comptoir, his photo and the phone links he issued.
// - prefs.set { staffId, prefs }: his home page, toasts, card order, blur and calendar feed (commands/team.js setPrefs).
//   The `prefs.` prefix is not one of state.js's CFG prefixes: one person's choice never reloads everyone's boot.
//   GUIDE-01a: tour { v, at, done } is his guided tour of the Comptoir, so it follows him from the tablet to his phone:
//   v the tour's version he was offered (0: never, the welcome card shows), at the step he stopped on, done finished or skipped.
// - staff.photo { id, v } with pii { photo } (a data URL, at most 24 KB): v 0 removes it. The `staff.` prefix bumps
//   cfgVersion, so the faces refresh on every screen. Replacing or removing a photo redacts the earlier copies from the
//   store (core/engine.js staffRedact), so a team member's face is erasable like a client's file.
// - phone.linkIssued { id: nonce, staffId, exp }: a 10-minute, single-use link that enrolls his own phone; used once
//   a device.enrolled carries `link: nonce` (state.js keeps it on the device).
// - phone.pinMissed { id } / phone.pinCleared { id }: wrong codes in a row on a linked phone, counted in the journal so
//   no restart resets them; phone.locked { id, staffId, name } then device.revoked at PHONE_MISSES (commands/team.js).
// - device.enrolled is shown in the feed (« JKut a lié un téléphone (iPhone de JKut) ») to `team` and to the person.
// Registered in core/extensions.js. No import of the engine or the state here.

/** @typedef {{ v: number, at: string, done: boolean }} TourPrefs */
/** @typedef {{ home: 'auto'|'espace'|'agenda'|'pilotage', notify: 'mine'|'all'|'none', buzz: boolean, cards: string[], hidden: string[], blur: 'auto'|'on'|'off', cal: number, calName: boolean, tour: TourPrefs }} Prefs */

export const HOMES = /** @type {const} */ (['auto', 'espace', 'agenda', 'pilotage']);
export const NOTIFY = /** @type {const} */ (['mine', 'all', 'none']);
export const BLUR = /** @type {const} */ (['auto', 'on', 'off']);
/** a phone link lives this long */
export const LINK_MS = 10 * 60000;
/** wrong codes in a row on a linked phone before it is removed: 10 tries at a 4-digit code is a 1-in-1000 guess */
export const PHONE_MISSES = 10;
/** expired links are forgotten after a day: the token carries its own expiry, so a forgotten one still reads as expired */
const LINK_KEEP = 24 * 3600000;

/**
 * A role's defaults: a barber hears about his own clients, the owner, managers and the desk about the whole salon.
 * @param {string} role @returns {Prefs}
 */
export function prefsDefaults(role) {
  return { home: 'auto', notify: role === 'barber' ? 'mine' : 'all', buzz: true, cards: [], hidden: [], blur: 'auto', cal: 0, calName: false, tour: { v: 0, at: '', done: false } };
}
/** What this person chose, over his role's defaults. @returns {Prefs} */
export function prefsOf(s, st) {
  return { ...prefsDefaults(st.role), ...((s.prefs && s.prefs.get(st.id)) || {}) };
}
/** The highest calendar generation this person ever had: a new link is always above it, so an old one never returns. */
export const calTopOf = (s, staffId) => (s.calTop && s.calTop.get(staffId)) || 0;
/** Has this link already enrolled a device (revoked since or not)? */
export const linkUsed = (s, nonce) => [...s.devices.values()].some((d) => d.link === nonce);

/** « de JKut », « d’Esteban », « du Soldat »: the default name of a linked phone */
export function ofName(name) {
  return /^le\s/i.test(name) ? 'du ' + name.slice(3) : /^les\s/i.test(name) ? 'des ' + name.slice(4) : /^[aeiouyhàâäéèêëîïôöûùü]/i.test(name) ? 'd’' + name : 'de ' + name;
}

/** @type {import('../core/extensions.js').Extension} */
export const staffprefsExtension = {
  init(s) { s.prefs = new Map(); s.staffPhotos = new Map(); s.photoEvents = new Map(); s.phoneLinks = new Map(); s.calTop = new Map(); s.phoneMisses = new Map(); },
  on: {
    'prefs.set': (s, e, d) => {
      s.prefs.set(d.staffId, { ...(s.prefs.get(d.staffId) || {}), ...d.prefs });
      if (d.prefs.cal) s.calTop.set(d.staffId, Math.max(calTopOf(s, d.staffId), d.prefs.cal));
    },
    // the bytes stay in pii: an event read after its redaction carries none, and the photo is gone (as it was meant to be).
    // photoV on the staff record (staffView's `photo`): not `photo`, which old journals of the site editor set to a URL
    'staff.photo': (s, e, d, p) => {
      const st = s.staff.get(d.id);
      // how many photo events he has: his first one leaves nothing earlier to redact (core/engine.js)
      s.photoEvents.set(d.id, (s.photoEvents.get(d.id) || 0) + 1);
      if (d.v && p.photo) { s.staffPhotos.set(d.id, { v: d.v, data: p.photo }); if (st) st.photoV = d.v; }
      else { s.staffPhotos.delete(d.id); if (st) st.photoV = 0; }
    },
    'phone.linkIssued': (s, e, d) => {
      for (const [k, l] of s.phoneLinks) if (l.exp < e.at - LINK_KEEP) s.phoneLinks.delete(k);
      s.phoneLinks.set(d.id, { id: d.id, staffId: d.staffId, exp: d.exp, at: e.at, by: e.actor.id });
    },
    'phone.pinMissed': (s, e, d) => { s.phoneMisses.set(d.id, (s.phoneMisses.get(d.id) || 0) + 1); },
    'phone.pinCleared': (s, e, d) => { s.phoneMisses.delete(d.id); },
    'phone.locked': (s, e, d) => { s.phoneMisses.delete(d.id); }
  },
  feed: ['device.enrolled', 'phone.locked'],
  // staffId null: no chair's toast, the person it is about in aboutStaffId (as the governance lines)
  item(r, f) {
    const d = f.data || {};
    if (!(f.type === 'phone.locked' || d.personal) || !(r.caps.has('team') || d.staffId === r.me.id)) return null;
    const who = (r.s.staff.get(d.staffId) || {}).name || 'Quelqu’un';
    if (f.type === 'phone.locked') return { v: f.v, at: f.at, by: f.actor.t, kind: 'phone', title: 'Téléphone ' + ofName(who) + ' retiré après ' + PHONE_MISSES + ' codes faux (' + d.name + ')', sub: 'À lier de nouveau avec un QR code', staffId: null, aboutStaffId: d.staffId };
    return { v: f.v, at: f.at, by: f.actor.t, kind: 'phone', title: who + ' a lié un téléphone (' + d.name + ')', sub: 'Accès de l’équipe', staffId: null, aboutStaffId: d.staffId };
  }
};
