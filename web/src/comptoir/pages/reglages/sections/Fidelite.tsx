// Fidélité: the stamp card in one screen (FID-03). The rule, who earns what, the referral, what it would have cost over the
// last 12 months (the simulator answers while the owner types, before anything is saved), what the client sees, the launch
// that opens every card with a head start, and the règlement. Saved with the other settings; the launch is its own act.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { refreshAll, useQuery } from '../../../../lib/query';
import { dates, eur, pct, plural } from '../../../../lib/format';
import { useDebounced } from '../../../../lib/hooks';
import { Link } from '../../../../lib/router';
import { headlineWords, ruleWords, termsText, type LaunchView, type LoyaltyCfg, type Reward, type Simulation } from '../../../../lib/loyalty';
import { StampCard } from '../../../../ui/StampCard';
import { Button, Chip, Modal, Note, Seg, Skeleton, Switch, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, num, useSave, useSection, type SectionProps } from '../shared';
import './fidelite.css';

type Head = 'none' | 'half' | 'full';
const HEADS: { v: Head; t: string }[] = [{ v: 'none', t: 'Aucun' }, { v: 'half', t: 'La moitié' }, { v: 'full', t: 'Presque tout' }];
const MONTHS = [{ days: 90, t: '3 mois' }, { days: 180, t: '6 mois' }, { days: 365, t: '12 mois' }];
/** « 3 nov. » */
const short = (day: string) => { const p = dates.dayParts(day); return p.d + ' ' + dates.MONTHS_SH[p.m - 1]; };
const euros = (cents: number) => String(Math.round(cents / 100));

/** A whole number of euros, typed in a field of its own and kept in cents: the text is the person's until he leaves it (a field emptied to retype is not a minimum). */
function Euros({ id, value, onChange, max = 200, min = 0, label }: { id: string; value: number; onChange: (cents: number) => void; max?: number; min?: number; label: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <input id={id} className="input input-money" inputMode="numeric" value={txt ?? euros(value)} aria-label={label}
      onChange={(e) => { const n = num(e.target.value, 0, max); setTxt(e.target.value.replace(/\D/g, '').slice(0, 4)); if (n * 100 >= min) onChange(n * 100); }}
      onBlur={() => setTxt(null)} />
  );
}
function Stepper({ value, min, max, onChange, less, more }: { value: number; min: number; max: number; onChange: (n: number) => void; less: string; more: string }) {
  return (
    <span className="fd-step">
      <Button icon="minus" aria-label={less} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
      <b className="tnum" aria-live="polite">{value}</b>
      <Button icon="plus" aria-label={more} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
    </span>
  );
}

/** One reward: a service offered up to an amount, or a flat amount off. */
function RewardEditor({ r, onChange, id }: { r: Reward; onChange: (r: Reward) => void; id: string }) {
  const { boot } = useApp();
  const services = boot.services.filter((x) => x.active && !x.pack);
  const refs = r.refs || [];
  const toggle = (sid: string) => onChange({ ...r, kind: 'service', refs: refs.includes(sid) ? refs.filter((x) => x !== sid) : [...refs, sid].slice(0, 10) });
  return (
    <div className="col" style={{ gap: 12 }}>
      <Seg<Reward['kind']> label="Récompense" value={r.kind} onChange={(kind) => onChange(kind === 'amount' ? { kind, amount: r.amount ?? 500 } : { kind, refs: r.refs ?? [], cap: r.cap ?? 2500 })} options={[{ v: 'service', t: 'Une prestation offerte' }, { v: 'amount', t: 'Une remise' }]} />
      {r.kind === 'amount' ? (
        <div className="fd-line"><label htmlFor={id + '-amount'}>Remise de</label><Euros id={id + '-amount'} value={r.amount ?? 500} max={200} min={100} label="Montant de la remise en euros" onChange={(c) => onChange({ kind: 'amount', amount: c })} /><span className="serif" style={{ fontSize: 24 }}>€</span></div>
      ) : (
        <div className="fd-sub">
          <div><span className="label" id={id + '-svc'}>Quelles prestations ?</span>
            <div className="chips" role="group" aria-labelledby={id + '-svc'}>{services.map((sv) => <Chip key={sv.id} small on={refs.includes(sv.id)} onClick={() => toggle(sv.id)}>{sv.name}</Chip>)}</div>
            <span className="faint" style={{ fontSize: 12.5 }}>{refs.length ? '' : 'Aucune sélectionnée : n’importe laquelle.'}</span>
          </div>
          <div className="fd-line"><label htmlFor={id + '-cap'}>Jusqu’à</label><Euros id={id + '-cap'} value={r.cap ?? 2500} max={200} label="Prix maximum offert en euros, vide pour le prix entier" onChange={(c) => onChange({ ...r, kind: 'service', refs, cap: c })} /><span className="serif" style={{ fontSize: 24 }}>€</span><span className="faint" style={{ fontSize: 12.5 }}>{(r.cap ?? 2500) ? '' : 'Le prix entier.'}</span></div>
        </div>
      )}
    </div>
  );
}

export default function Fidelite({ s }: SectionProps) {
  const { serviceById, reloadBoot } = useApp();
  const sec = useSection<LoyaltyCfg>(s.loyalty);
  const c = sec.v;
  const { busy, save } = useSave();
  const nameOf = (id: string) => serviceById.get(id)?.name || '';
  const set = (patch: Partial<LoyaltyCfg>) => sec.setV({ ...c, ...patch });
  const setRef = (patch: Partial<LoyaltyCfg['referral']>) => set({ referral: { ...c.referral, ...patch } });

  // the simulator reads what is typed, not what is saved; it waits for the typing to stop
  const kind = c.reward.kind;
  const q = new URLSearchParams({ goal: String(c.goal), minNet: String(c.minNet), kind, ...(kind === 'amount' ? { amount: String(c.reward.amount ?? 500) } : { cap: String(c.reward.cap ?? 2500), refs: (c.reward.refs || []).join(',') }) });
  const key = '/api/v1/loyalty/simulate?' + q.toString();
  const sim = useQuery<Simulation>(useDebounced(key, 350));
  const warm = !!sim.data && sim.data.share > 0.08;

  const saveAll = () => save({ loyalty: { enabled: c.enabled, goal: c.goal, minNet: c.minNet, reward: c.reward.kind === 'amount' ? { kind: 'amount', amount: c.reward.amount ?? 500 } : { kind: 'service', refs: c.reward.refs || [], cap: c.reward.cap ?? 0 }, rewardDays: c.rewardDays, referral: { enabled: c.referral.enabled, referrer: c.referral.referrer, referee: c.referral.referee, perYear: c.referral.perYear } } });

  const [asking, setAsking] = useState(false);
  const [head, setHead] = useState<Head>('half');
  const launch = useQuery<LaunchView>('/api/v1/loyalty/launch?headStart=' + (asking ? head : s.loyalty.headStart || 'half'));
  const [launching, setLaunching] = useState(false);
  const go = async () => {
    setLaunching(true);
    try {
      const r = await api.post<{ clients: number }>('/api/v1/loyalty/launch', { headStart: head });
      toast({ title: 'Programme lancé', sub: plural(r.clients, 'carte ouverte', 'cartes ouvertes'), icon: 'check' });
      setAsking(false); refreshAll(); await reloadBoot();
    } catch (e) { toastError(e); } finally { setLaunching(false); }
  };

  const preview = Math.max(1, Math.min(c.goal - 1, Math.round((c.goal * 2) / 3)));
  const rule = ruleWords(c, nameOf);
  const plan = launch.data?.plan;
  const done = launch.data?.launched;
  const dirty = sec.dirty;

  return (
    <div className="fd touch44">
      <Card title="Programme de fidélité" icon="gift">
        <div data-guide="fidelite.switch">
          <Switch on={c.enabled} onChange={(enabled) => set({ enabled })} title="Programme de fidélité" hint="Tes clients cumulent à chaque passage payé. La récompense s’applique en un geste à la caisse." />
        </div>
      </Card>

      <div className="col" style={{ gap: 16, opacity: c.enabled ? 1 : 0.62 }} aria-disabled={!c.enabled}>
        <Card title="La carte" icon="star">
          <div className="col" style={{ gap: 18 }} data-guide="fidelite.rules">
            <div><span className="label" id="fd-goal">Récompense au bout de</span>
              <div className="fd-line" role="group" aria-labelledby="fd-goal"><Stepper value={c.goal} min={2} max={60} onChange={(goal) => set({ goal })} less="Un passage de moins" more="Un passage de plus" /><span className="serif" style={{ fontSize: 24 }}>passages</span></div></div>
            <div><span className="label" id="fd-min">Un passage compte dès</span>
              <div className="chips" role="group" aria-labelledby="fd-min">{[500, 1000, 1500, 2000].concat([500, 1000, 1500, 2000].includes(c.minNet) ? [] : [c.minNet]).sort((a, b) => a - b).map((v) => <Chip key={v} small on={c.minNet === v} onClick={() => set({ minNet: v })}>{eur(v)}</Chip>)}</div>
              <span className="faint" style={{ fontSize: 12.5 }}>Prestations payées ; un seul tampon par jour. Une coupe de carnet ou d’abonnement n’en donne pas.</span></div>
            <RewardEditor id="fd-r" r={c.reward} onChange={(reward) => set({ reward })} />
            <div><span className="label" id="fd-days">Valable</span>
              <div className="chips" role="group" aria-labelledby="fd-days">{MONTHS.concat(MONTHS.some((m) => m.days === c.rewardDays) ? [] : [{ days: c.rewardDays, t: c.rewardDays + ' jours' }]).map((m) => <Chip key={m.days} small on={c.rewardDays === m.days} onClick={() => set({ rewardDays: m.days })}>{m.t}</Chip>)}</div></div>
          </div>
        </Card>

        <Card title="Parrainage" icon="heart">
          <div data-guide="fidelite.referral" className="col" style={{ gap: 14 }}>
            <Switch on={c.referral.enabled} onChange={(enabled) => setRef({ enabled })} title="Parrainage" hint="Un client en amène un nouveau : chacun reçoit un cadeau. Son ami le trouve sur son lien, ou le dit à la caisse." />
            {c.referral.enabled ? (
              <div className="fd-sub">
                <div className="fd-line"><label htmlFor="fd-rf">Pour lui</label><Euros id="fd-rf" value={c.referral.referrer.amount ?? 500} min={100} label="Cadeau du parrain en euros" onChange={(a) => setRef({ referrer: { kind: 'amount', amount: a } })} /><span className="serif" style={{ fontSize: 24 }}>€</span>
                  <label htmlFor="fd-re">Pour son ami</label><Euros id="fd-re" value={c.referral.referee.amount ?? 500} min={100} label="Cadeau de son ami en euros" onChange={(a) => setRef({ referee: { kind: 'amount', amount: a } })} /><span className="serif" style={{ fontSize: 24 }}>€</span></div>
                <div className="fd-line"><span className="label" id="fd-py" style={{ margin: 0 }}>Parrainages par an et par client</span><Stepper value={c.referral.perYear} min={0} max={20} onChange={(perYear) => setRef({ perYear })} less="Un parrainage de moins" more="Un parrainage de plus" /><span className="faint" style={{ fontSize: 12.5 }}>{c.referral.perYear ? 'au plus' : 'sans limite'}</span></div>
              </div>
            ) : null}
          </div>
        </Card>

        <Note icon="info">La commission sur une coupe offerte se règle dans <Link to="/reglages/equipe" className="link">Équipe › Rémunération</Link>.</Note>
      </div>

      <Card title="Ce que ça coûte" icon="euro">
        <div data-guide="fidelite.simulator" aria-live="polite">
          {!sim.data ? <Skeleton h={64} /> : sim.data.clients ? (
            <p className={'fd-sim' + (warm ? ' warn' : '')}>Sur les 12 derniers mois, ces règles {sim.data.rewards ? 'auraient offert ' + plural(sim.data.rewards, 'récompense') + ' à ' + plural(sim.data.winners, 'client') : 'n’auraient offert aucune récompense'} : {eur(sim.data.value)}, soit {pct(sim.data.share, 1)} du chiffre des prestations.</p>
          ) : <p className="fd-sim">Pas encore assez de tickets pour estimer.</p>}
        </div>
        {warm ? <Note tone="warn" icon="alert">C’est généreux : un passage de plus ou une récompense plus petite ?</Note> : null}
        <p className="faint" style={{ fontSize: 12.5 }}>Les tickets payés par client, rejoués avec ce que tu as saisi, aux prix d’aujourd’hui. Rien n’est enregistré tant que tu n’appuies pas sur Enregistrer.</p>
      </Card>

      <Card title="Ce que voit ton client" icon="eye">
        <div className="fd-prev" data-guide="fidelite.preview">
          <StampCard units={preview} goal={c.goal} />
          <b>{headlineWords({ units: preview, goal: c.goal, rewards: [] }, c)}</b>
          <p>{rule}</p>
        </div>
      </Card>

      <Card title="Lancement" icon="bolt">
        <div data-guide="fidelite.launch" className="col" style={{ gap: 12 }}>
          {!launch.data ? <Skeleton h={44} /> : done ? (
            <p><b>Lancé le {short(done.day)}</b>{done.clients ? ' · ' + plural(done.clients, 'carte ouverte', 'cartes ouvertes') : ''}</p>
          ) : (
            <>
              <p className="muted">Au lancement, chaque client venu ces 12 derniers mois démarre avec une partie de ses passages. Tu le fais une seule fois, quand les clients de l’ancien site sont repris.</p>
              <div className="row wrap"><Button variant="primary" icon="bolt" disabled={!s.loyalty.enabled || dirty} onClick={() => { setHead(s.loyalty.headStart || 'half'); setAsking(true); }}>Lancer le programme</Button>
                {!s.loyalty.enabled ? <span className="faint" style={{ fontSize: 13 }}>Active le programme et enregistre d’abord.</span> : dirty ? <span className="faint" style={{ fontSize: 13 }}>Enregistre tes réglages d’abord.</span> : null}</div>
            </>
          )}
        </div>
      </Card>

      <Card title="Règlement" icon="journal">
        <details className="fd-terms" data-guide="fidelite.terms">
          <summary>Le texte que tes clients lisent</summary>
          <ul>{termsText(c, nameOf).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </details>
      </Card>

      <SaveBar dirty={dirty} busy={busy} onReset={sec.reset} onSave={saveAll} />

      <Modal open={asking} onClose={() => setAsking(false)} label="Lancer le programme">
        <h2>Lancer le programme</h2>
        <div><span className="label" id="fd-head">Départ</span><Seg<Head> label="Départ" value={head} onChange={setHead} options={HEADS} /></div>
        {!plan || plan.headStart !== head ? <Skeleton h={48} /> : plan.cap <= 0 ? (
          <p>Toutes les cartes commencent à zéro. Tu ne pourras pas relancer.</p>
        ) : (
          <p>{plural(plan.clients, 'client démarre', 'clients démarrent')} avec leurs passages des 12 derniers mois ({plan.cap} tampons au plus). Tu ne pourras pas relancer.</p>
        )}
        <div className="acts"><Button variant="ghost" onClick={() => setAsking(false)}>Annuler</Button><Button variant="primary" busy={launching} disabled={!plan || plan.headStart !== head} onClick={go}>Départ</Button></div>
      </Modal>
    </div>
  );
}
