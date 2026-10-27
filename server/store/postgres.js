// @ts-check
// Production store: Postgres (Neon, Supabase, RDS…). The journal is one append-only table;
// the primary key on (epoch, v) is what makes two simultaneous writers impossible.
import pg from 'pg';
import { randomBytes } from 'node:crypto';

/** @typedef {import('./memory.js').Store} Store */
/** @typedef {import('../core/journal.js').JEvent} JEvent */

const SCHEMA = `
create table if not exists lx_meta (k text primary key, v text not null);
create table if not exists lx_events (
  epoch text not null,
  v bigint not null,
  id text not null,
  at bigint not null,
  type text not null,
  actor jsonb not null,
  data jsonb not null,
  pii jsonb,
  ph text,
  p text not null,
  h text not null,
  primary key (epoch, v)
);
create unique index if not exists lx_events_id on lx_events (epoch, id);
create index if not exists lx_events_type on lx_events (epoch, type);
`;

const COLS = ['epoch', 'v', 'id', 'at', 'type', 'actor', 'data', 'pii', 'ph', 'p', 'h'];

/** @returns {JEvent} */
function rowToEvent(r) {
  /** @type {any} */
  const e = { v: Number(r.v), id: r.id, at: Number(r.at), type: r.type, actor: r.actor, data: r.data, ph: r.ph, p: r.p, h: r.h };
  if (r.pii != null) e.pii = r.pii;
  return e;
}

/**
 * @param {{ url?: string, pool?: any }} o
 * @returns {Store}
 */
export function postgresStore(o) {
  // a database that does not answer is known within 3 s, and a stuck statement within 10: the instance then serves
  // reads from memory and refuses writes (http/app.js) instead of holding every request for the platform's timeout.
  // statement_timeout is the database's own: it aborts the statement and its transaction cleanly. query_timeout only
  // backs it up for a link that went silent (no answer at all); a connection it hits is destroyed, never reused.
  // keepAlive finds the idle connections a restart or a failover left dead.
  const pool = o.pool || new pg.Pool({
    connectionString: o.url, max: 4, idleTimeoutMillis: 20000, connectionTimeoutMillis: 3000,
    statement_timeout: 10000, query_timeout: 15000, keepAlive: true, keepAliveInitialDelayMillis: 10000
  });
  // an idle connection the database dropped (restart, failover, network reset) is an 'error' event on the pool: without
  // a listener it kills the process, and with it the memory that serves reads during the outage
  if (!o.pool) pool.on('error', (e) => console.error('[lx] pg idle client:', e && e.message ? e.message : e));
  /** @type {Promise<string>|null} */
  let ready = null;
  const init = () => {
    if (!ready) {
      ready = (async () => {
        await pool.query(SCHEMA);
        await pool.query(`insert into lx_meta (k, v) values ('epoch', $1) on conflict (k) do nothing`, ['p' + randomBytes(6).toString('hex')]);
        return (await pool.query(`select v from lx_meta where k = 'epoch'`)).rows[0].v;
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  };
  const epochNow = async () => { await init(); return (await pool.query(`select v from lx_meta where k = 'epoch'`)).rows[0].v; };

  return {
    kind: 'postgres',
    async read(after) {
      const epoch = await epochNow();
      /** @type {JEvent[]} */
      const out = [];
      let from = after;
      for (;;) {
        const { rows } = await pool.query(`select v, id, at, type, actor, data, pii, ph, p, h from lx_events where epoch = $1 and v > $2 order by v limit 5000`, [epoch, from]);
        for (const r of rows) out.push(rowToEvent(r));
        if (rows.length < 5000) break;
        from = Number(rows[rows.length - 1].v);
      }
      return { epoch, events: out };
    },
    async append(list, ep) {
      if (!list.length) return { ok: true };
      await init();
      const client = await pool.connect();
      /** @type {any} a connection that failed midway may still hold an open transaction: destroyed, not reused */
      let broken = null;
      try {
        await client.query('begin');
        const cur = (await client.query(`select v from lx_meta where k = 'epoch'`)).rows[0].v;
        if (cur !== ep) { await client.query('rollback'); return { ok: false }; }
        const max = Number((await client.query(`select coalesce(max(v), 0) as m from lx_events where epoch = $1`, [ep])).rows[0].m);
        if (list[0].v !== max + 1) { await client.query('rollback'); return { ok: false }; }
        for (let i = 0; i < list.length; i += 400) {
          const chunk = list.slice(i, i + 400);
          const params = [];
          const values = chunk.map((e, j) => {
            params.push(ep, e.v, e.id, e.at, e.type, JSON.stringify(e.actor), JSON.stringify(e.data), e.pii == null ? null : JSON.stringify(e.pii), e.ph ?? null, e.p, e.h);
            const b = j * COLS.length;
            return '(' + COLS.map((_, k) => '$' + (b + k + 1)).join(',') + ')';
          });
          await client.query(`insert into lx_events (${COLS.join(',')}) values ${values.join(',')}`, params);
        }
        await client.query('commit');
        return { ok: true };
      } catch (e) {
        if (e && /** @type {any} */ (e).code === '23505') { await client.query('rollback').catch((r) => { broken = r; }); return { ok: false }; } // someone else took that version
        broken = e;
        throw e;
      } finally {
        client.release(broken || undefined);
      }
    },
    async redact(match) {
      const epoch = await epochNow();
      const { rows } = await pool.query(`select v, id, at, type, actor, data, pii, ph, p, h from lx_events where epoch = $1 and pii is not null`, [epoch]);
      const vs = rows.map(rowToEvent).filter(match).map((e) => e.v);
      if (vs.length) await pool.query(`update lx_events set pii = null where epoch = $1 and v = any($2::bigint[])`, [epoch, vs]);
      return vs.length;
    },
    async reset() {
      await init();
      const next = 'p' + randomBytes(6).toString('hex');
      await pool.query(`update lx_meta set v = $1 where k = 'epoch'`, [next]);
      await pool.query(`delete from lx_events where epoch <> $1`, [next]);
      return next;
    },
    async secret(name, make) {
      await init();
      await pool.query(`insert into lx_meta (k, v) values ($1, $2) on conflict (k) do nothing`, ['secret:' + name, make()]);
      return (await pool.query(`select v from lx_meta where k = $1`, ['secret:' + name])).rows[0].v;
    },
    async close() { await pool.end(); }
  };
}
