// @ts-check
// Did the texts bring people back? Counted in distinct clients, never in appointments, so the rate cannot pass
// 100 %: a client texted once who then books twice is one client back. A booking counts only when it was made
// within WINDOW_DAYS after a text of that kind (later, the text had nothing to do with it), and once per kind.
const DAY_MS = 86400000;
export const WINDOW_DAYS = 21;
// texts that left or are leaving; skipped, failed and late ones never reached anyone, and one still held by the
// quiet hours (queued, due later) is counted from the morning it leaves, not from the click
const REACHED = new Set(['sent', 'simulated', 'queued', 'claimed']);

/** @typedef {{ sent: number, clientsBack: number, revenueBack: number, rate: number }} Attribution */

/** The file a client lives in now (merged files point to the one they were merged into). */
function rootOf(s, cid) {
  for (let i = 0; i < 8; i++) { const c = s.clients.get(cid); if (!c || !c.mergedInto) return cid; cid = c.mergedInto; }
  return cid;
}

/**
 * What a booking brought: the ticket once paid (minus refunds), the booked price until then. So the figure mixes
 * money taken and appointments still to come; the Comptoir words it "de rendez-vous", never as cash in hand.
 */
function valueOf(s, a) {
  const sale = a.saleId ? s.sales.get(a.saleId) : null;
  return sale ? sale.totals.revenue - (sale.refunded || 0) : a.price || 0;
}

/**
 * Follow-up figures per template, over the texts queued in the last `days` days.
 * @param {any} s
 * @param {{ now: number, days?: number, windowDays?: number, templates?: string[] }} o
 * @returns {Record<string, Attribution>}
 */
export function attribution(s, { now, days = 60, windowDays = WINDOW_DAYS, templates }) {
  const since = now - days * DAY_MS, win = windowDays * DAY_MS;
  /** @type {Map<string, Map<string, number[]>>} template → client → when each text left */
  const texts = new Map();
  for (const m of s.messages.values()) {
    if (!m.cid || m.at < since || !REACHED.has(m.status) || (m.status === 'queued' && m.dueAt > now)) continue;
    if (templates && !templates.includes(m.template)) continue;
    let byClient = texts.get(m.template);
    if (!byClient) texts.set(m.template, (byClient = new Map()));
    const cid = rootOf(s, m.cid);
    const list = byClient.get(cid) || [];
    // a quiet text counts from when it may leave (8:00), not from when it was queued: a booking made before it is
    // not its doing. Not sentAt: a text leaves at most 6 h after that (later it expires), and a demo outbox sets it at boot
    list.push(Math.max(m.at, m.dueAt || 0));
    byClient.set(cid, list);
  }
  /** @type {Map<string, any[]>} */
  const booked = new Map();
  for (const a of s.appts.values()) {
    if (!a.clientId || a.status === 'cancelled' || a.status === 'no_show') continue;
    const list = booked.get(a.clientId) || [];
    list.push(a);
    booked.set(a.clientId, list);
  }
  /** @type {Record<string, Attribution>} */
  const out = {};
  for (const t of templates || []) out[t] = { sent: 0, clientsBack: 0, revenueBack: 0, rate: 0 };
  for (const [tpl, byClient] of texts) {
    let back = 0, revenue = 0;
    for (const [cid, times] of byClient) {
      const mine = (booked.get(cid) || []).filter((a) => times.some((t) => a.createdAt > t && a.createdAt <= t + win));
      if (!mine.length) continue;
      back++;
      for (const a of mine) revenue += valueOf(s, a);
    }
    const sent = byClient.size;
    out[tpl] = { sent, clientsBack: back, revenueBack: revenue, rate: sent ? Math.min(100, Math.round((back / sent) * 100)) : 0 };
  }
  return out;
}
