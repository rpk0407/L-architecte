// @ts-check
// Espace client (AC-01), as the projection folds it. An account is a verified sign-in attached to a client file: no
// password, no profile of its own (the file IS the client). Registered in core/extensions.js; the commands are in
// commands/accounts.js, the codes in domain/otp.js. No import of the engine or the state here (see core/extensions.js).
//
// s.accounts: cid (the file signed in on) → { cid, since, lastAt, count, revokedAt, fenced, historyFrom, named,
//   prefs { staffId } (AC-02), eraseAt (AC-02: erasure asked, 0 if not) }. account.closed deletes the row.
// s.accountPast: cid → { cid, since, lastAt, fenced, historyFrom, named, closedAt }: what outlives « Supprimer mon espace »,
//   so opening it again keeps the fence (the new holder of a recycled number cannot close and reopen to see more) and
//   no cookie from before the closing comes back to life. Erasure alone forgets it.
// s.otpUsed: the codes (message ids) that opened a session or were burned: a code works once.
// s.codeMisses: msgId → { n, names, ids }: wrong tries against that code (names: a wrong first name after the right code),
//   by their deterministic ids (acm_<msgId>_<k>), so two instances counting the same try never count it twice.
// None of these events carries personal data: each names the file (cid), so an erasure reaches them.
// accountOf reads a file and every file merged into it, so a merge needs nothing here (state.js does not hand on
// client.merged).

/** The first name a feed line may show, through merges. */
function firstOf(s, cid) {
  let c = cid ? s.clients.get(cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return (c && !c.erased && c.first) || 'Client';
}

/** One view of several rows (files merged together): the latest seen, revoked at the latest revocation, fenced if any is. */
function group(rows) {
  if (!rows.length) return null;
  const base = rows.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
  const fenced = rows.filter((x) => x.fenced);
  return {
    ...base,
    since: Math.min(...rows.map((x) => x.since)),
    count: rows.reduce((t, x) => t + (x.count || 0), 0),
    revokedAt: Math.max(...rows.map((x) => x.revokedAt || 0)),
    fenced: fenced.length > 0,
    // the latest fence is the strictest: nothing before it shows
    historyFrom: fenced.length ? fenced.map((x) => x.historyFrom || '').sort().slice(-1)[0] || null : null,
    named: rows.every((x) => x.named),
    eraseAt: Math.max(...rows.map((x) => x.eraseAt || 0))
  };
}

/**
 * The account of these files (a file and the ones merged into it), or null when none is open.
 * @param {any} s @param {string[]} ids
 */
export function accountOf(s, ids) {
  if (!s.accounts) return null;
  return group(ids.map((id) => s.accounts.get(id)).filter(Boolean));
}

/** What earlier openings of these files left (even closed since), or null when none was ever opened. @param {any} s @param {string[]} ids */
export function accountPastOf(s, ids) {
  if (!s.accountPast) return null;
  const rows = ids.map((id) => s.accountPast.get(id)).filter(Boolean);
  if (!rows.length) return null;
  return { ...group(rows.map((x) => ({ ...x, count: 0, revokedAt: x.closedAt || 0, eraseAt: 0 }))), closedAt: Math.max(...rows.map((x) => x.closedAt || 0)) };
}

/** @type {import('../core/extensions.js').Extension} */
export const accountsExtension = {
  init(s) { s.accounts = new Map(); s.accountPast = new Map(); s.otpUsed = new Set(); s.codeMisses = new Map(); },
  on: {
    'account.signedIn': (s, e, d) => {
      if (!d || !d.cid) return;
      if (typeof d.msgId === 'string' && d.msgId.startsWith('msg_')) s.otpUsed.add(d.msgId);
      const past = s.accountPast.get(d.cid);
      let row = s.accounts.get(d.cid);
      if (row) { row.lastAt = e.at; row.count++; }
      else {
        // the first opening fixes the fence; an opening after « Supprimer mon espace » keeps the one before, and every
        // cookie from before the closing stays dead
        const fenced = past ? past.fenced : !!d.fenced;
        row = {
          cid: d.cid, since: e.at, lastAt: e.at, count: 1, revokedAt: past ? past.closedAt || 0 : 0,
          fenced, historyFrom: past ? past.historyFrom : fenced ? d.historyFrom || null : null,
          named: past ? past.named : !!d.named, prefs: { staffId: null }, eraseAt: 0
        };
        s.accounts.set(d.cid, row);
      }
      s.accountPast.set(d.cid, { cid: d.cid, since: past ? past.since : row.since, lastAt: e.at, fenced: row.fenced, historyFrom: row.historyFrom, named: row.named, closedAt: past ? past.closedAt || 0 : 0 });
    },
    'account.codeMissed': (s, e, d) => {
      if (!d || !d.msgId || !d.id) return;
      const x = s.codeMisses.get(d.msgId) || { n: 0, names: 0, ids: /** @type {string[]} */ ([]) };
      if (x.ids.includes(d.id)) return;
      x.ids.push(d.id); x.n++;
      if (d.name) x.names++;
      s.codeMisses.set(d.msgId, x);
    },
    'account.codeBurned': (s, e, d) => { for (const id of (d && d.ids) || []) s.otpUsed.add(id); },
    'account.revoked': (s, e, d) => { const row = d && s.accounts.get(d.cid); if (row) row.revokedAt = e.at; },
    'account.closed': (s, e, d) => {
      if (!d || !s.accounts.has(d.cid)) return;
      s.accounts.delete(d.cid);
      const past = s.accountPast.get(d.cid);
      if (past) past.closedAt = e.at;
    },
    // AC-02's writes, folded here so that package adds no projection code
    'account.prefs': (s, e, d) => { const row = d && s.accounts.get(d.cid); if (row) row.prefs = { ...row.prefs, ...(d.patch || {}) }; },
    'account.eraseRequested': (s, e, d) => { const row = d && s.accounts.get(d.cid); if (row && !row.eraseAt) row.eraseAt = e.at; },
    // the file is gone: so is its account, what its codes counted, and the memory of its fence
    'client.erased': (s, e, d) => {
      const ids = new Set(d.ids || [d.id]);
      for (const cid of ids) { s.accounts.delete(cid); s.accountPast.delete(cid); }
      for (const m of s.messages.values()) if (m.template === 'otp' && ids.has(m.cid)) s.codeMisses.delete(m.id);
    }
  },
  feed: ['account.signedIn', 'account.eraseRequested'],
  item(r, f) {
    const d = f.data || {};
    const base = { v: f.v, at: f.at, by: f.actor.t, kind: 'account', clientId: d.cid, staffId: null };
    // a space opened on a file nobody saw for long, or whose first name the person did not give: someone checks it is him
    if (f.type === 'account.signedIn') {
      if (!d.fenced || !d.opened || !r.caps.has('client.view')) return null;
      return { ...base, title: 'Espace ouvert sur une fiche inactive', sub: firstOf(r.s, d.cid) + ' · vérifie que c’est la même personne' };
    }
    if (f.type === 'account.eraseRequested') {
      if (!r.caps.has('client.erase')) return null;
      return { ...base, title: 'Demande d’effacement · ' + firstOf(r.s, d.cid), sub: 'À traiter sous un mois : Clients › fiche › Effacer' };
    }
    return null;
  }
};
