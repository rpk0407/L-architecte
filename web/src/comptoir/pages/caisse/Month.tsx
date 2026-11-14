// Caisse › Le mois (owner, manager): what came in by method, each barber's revenue with his estimated commission and the
// tips owed to him, the gift cards sold and used. Read from the same report as Rapports and the payroll statement
// (GET /api/v1/caisse/mois): an estimate until the month is closed, the payroll prevails.
import { useQuery } from '../../../lib/query';
import { setQuery, useRoute } from '../../../lib/router';
import { eur } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Note, Skeleton } from '../../../ui/kit';
import { useApp } from '../../state';
import { METHOD_WORDS } from './DayMoney';

type TillMonth = {
  month: string; label: string; provisional: boolean; note: string; takings: number; net: number; tips: number; tickets: number;
  methods: { method: string; amount: number }[];
  staff: { id: string; name: string; color: string; performed: number; commission: number; tips: number; tipsCard: number; tipsCash: number; tickets: number }[];
  commissions: number; tipsOwed: { id: string; name: string; amount: number }[];
  giftcards: { sold: number; used: number; outstanding: number };
};
const c = (v: number) => eur(v, { decimals: v % 100 !== 0 });
const shift = (m: string, n: number) => { const d = new Date(m + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

export function Month() {
  const { boot, pulse } = useApp();
  const cur = (pulse?.today || boot.today).slice(0, 7);
  const q = useRoute().query.get('mois');
  const month = q && /^\d{4}-\d{2}$/.test(q) && q <= cur ? q : cur;
  const { data } = useQuery<TillMonth>('/api/v1/caisse/mois?month=' + month);
  return (
    <div className="col cs-month" style={{ gap: 14 }} data-guide="cs-month">
      <div className="row cs-month-nav">
        <Button icon="chevL" aria-label="Mois précédent" onClick={() => setQuery({ mois: shift(month, -1) })} />
        <h2 className="grow serif">{data?.label || month}</h2>
        <Button icon="arrowR" aria-label="Mois suivant" disabled={month >= cur} onClick={() => setQuery({ mois: shift(month, 1) === cur ? null : shift(month, 1) })} />
      </div>
      {!data ? <Skeleton h={300} r={22} /> : (
        <>
          {data.provisional ? <Note icon="info">Mois en cours : chiffres provisoires. Commissions estimées, la paie fait foi.</Note> : null}
          <section className="card cs-list" aria-labelledby="mo-in">
            <div className="card-h"><h2 id="mo-in"><Icon name="cash" size={16} />Encaissé</h2><b className="money tnum">{c(data.takings)}</b></div>
            {data.methods.map((m) => <div key={m.method} className="kv"><span>{METHOD_WORDS[m.method] || m.method}</span><b className="money tnum">{c(m.amount)}</b></div>)}
            {data.tips ? <div className="kv"><span>dont pourboires</span><b className="money tnum">{c(data.tips)}</b></div> : null}
            <p className="faint dm-line">{data.tickets} ticket{data.tickets > 1 ? 's' : ''} · chiffre {c(data.net)}</p>
          </section>
          <section className="card cs-list" aria-labelledby="mo-staff">
            <div className="card-h"><h2 id="mo-staff"><Icon name="equipe" size={16} />Par barbier</h2><span className="muted">commissions {c(data.commissions)}</span></div>
            {!data.staff.length ? <p className="muted dm-line">Rien ce mois-ci.</p> : (
              <ul className="list">{data.staff.map((s) => (
                <li key={s.id} className="li">
                  <Avatar name={s.name} color={s.color} size="sm" />
                  <span className="li-main"><b>{s.name}</b><small>commission {c(s.commission)}{s.tips ? ' · pourboires ' + c(s.tips) + (s.tipsCash ? ' (dont ' + c(s.tipsCash) + ' en espèces)' : '') : ''}</small></span>
                  <span className="li-end"><b className="money tnum">{c(s.performed)}</b><small className="faint">{s.tickets} ticket{s.tickets > 1 ? 's' : ''}</small></span>
                </li>
              ))}</ul>
            )}
          </section>
          {data.tipsOwed.length ? (
            <section className="card cs-list" aria-labelledby="mo-tips">
              <div className="card-h"><h2 id="mo-tips"><Icon name="heart" size={16} />Pourboires à reverser</h2></div>
              <p className="faint dm-line">Payés par carte ou en ligne avec le ticket : ils sont sur le compte du salon.</p>
              {data.tipsOwed.map((t) => <div key={t.id} className="kv"><span>{t.name}</span><b className="money tnum">{c(t.amount)}</b></div>)}
            </section>
          ) : null}
          <section className="card cs-list" aria-labelledby="mo-gift">
            <div className="card-h"><h2 id="mo-gift"><Icon name="gift" size={16} />Cartes cadeaux</h2></div>
            <div className="kv"><span>Vendues</span><b className="money tnum">{c(data.giftcards.sold)}</b></div>
            <div className="kv"><span>Utilisées</span><b className="money tnum">{c(data.giftcards.used)}</b></div>
            <div className="kv"><span>Encore à utiliser (fin du mois)</span><b className="money tnum">{c(data.giftcards.outstanding)}</b></div>
          </section>
        </>
      )}
    </div>
  );
}
