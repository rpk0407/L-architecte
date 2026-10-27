// Réservation en ligne: what the site offers, until when a client can change their mind, and deposits.
// The deposit and cancellation rules are part of the CGV a client accepts: changing them dates a new version (the server does it).
import { eur, money } from '../../../../lib/format';
import { Chip, Field, Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, num, useSave, useSection, type SectionProps } from '../shared';

export default function Reservation({ s }: SectionProps) {
  const { boot } = useApp();
  const b = useSection(s.booking);
  const d = useSection(s.deposits);
  const { busy, save } = useSave();
  const B = b.v, D = d.v;
  // production without Stripe: the site books without a deposit, whatever the rule below says
  const noOnline = boot.mode !== 'demo' && boot.providers.payments === 'simulated';
  const cgvChanged = d.dirty || B.cancelUntilHours !== s.booking.cancelUntilHours;
  const notice = [[0, 'Aucun'], [30, '30 min'], [60, '1 h'], [120, '2 h'], [720, 'La veille (12 h)'], [1440, '24 h']] as [number, string][];
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Prise de rendez-vous" icon="globe">
        <Switch on={B.enabled} onChange={(v) => b.setV({ ...B, enabled: v })} title="Réservation en ligne ouverte" hint={B.enabled ? 'Les clients réservent sur le site, 24 h sur 24.' : 'Le site invite à appeler le salon.'} />
        <Field label="Intervalle des créneaux proposés"><div className="chips">{[15, 20, 30].map((m) => <Chip key={m} small on={B.stepMin === m} onClick={() => b.setV({ ...B, stepMin: m })}>{m} min</Chip>)}</div></Field>
        <Field label="Délai minimum avant un rendez-vous"><div className="chips">{notice.map(([m, t]) => <Chip key={m} small on={B.minNoticeMin === m} onClick={() => b.setV({ ...B, minNoticeMin: m })}>{t}</Chip>)}</div></Field>
        <Field label="Jusqu’à combien de jours à l’avance"><div className="chips">{[14, 30, 60, 90].map((n) => <Chip key={n} small on={B.maxDaysAhead === n} onClick={() => b.setV({ ...B, maxDaysAhead: n })}>{n} jours</Chip>)}</div></Field>
        <Field label="Annulation ou déplacement en ligne possible jusqu’à" hint="Après, le client doit appeler : c’est là que l’acompte protège le salon. Ce délai figure dans les CGV du site."><div className="chips">{[2, 6, 12, 24, 48].map((n) => <Chip key={n} small on={B.cancelUntilHours === n} onClick={() => b.setV({ ...B, cancelUntilHours: n })}>{n} h avant</Chip>)}</div></Field>
        <Switch on={B.waitlist} onChange={(v) => b.setV({ ...B, waitlist: v })} title="Liste d’attente" hint="Quand c’est complet, le client s’inscrit ; une place libérée lui est proposée par SMS." />
        <Switch on={B.walkinWait} onChange={(v) => b.setV({ ...B, walkinWait: v })} title="Afficher l’attente sans rendez-vous" hint="Le site montre en direct « environ 20 min d’attente »." />
      </Card>
      <Card title="Acomptes et absences" icon="card">
        {noOnline ? <Note icon="info">Les acomptes s’activeront dès que Stripe sera branché. En attendant, les clients réservent sans payer.</Note> : null}
        <Field label="Demander un acompte">
          <div className="chips">
            <Chip small on={D.mode === 'none'} onClick={() => d.setV({ ...D, mode: 'none' })}>Jamais</Chip>
            <Chip small on={D.mode === 'threshold'} onClick={() => d.setV({ ...D, mode: 'threshold' })}>Au-delà d’un montant</Chip>
            <Chip small on={D.mode === 'all'} onClick={() => d.setV({ ...D, mode: 'all' })}>Toujours</Chip>
          </div>
        </Field>
        {D.mode !== 'none' ? (
          <div className="grid2">
            {D.mode === 'threshold' ? <Field label="À partir de (€)" htmlFor="dp-t"><input id="dp-t" className="input" inputMode="decimal" value={(D.thresholdCents / 100).toString().replace('.', ',')} onChange={(e) => d.setV({ ...D, thresholdCents: money.parseEur(e.target.value) ?? 0 })} /></Field> : <span />}
            <Field label="Montant de l’acompte (% du prix)" htmlFor="dp-p"><input id="dp-p" className="input" inputMode="numeric" value={D.percent} onChange={(e) => d.setV({ ...D, percent: num(e.target.value, 5, 100) })} /></Field>
          </div>
        ) : null}
        <p className="muted" style={{ fontSize: 13.5 }}>{noOnline && D.mode !== 'none' ? <><b>Sans Stripe, aucun acompte n’est demandé en ligne.</b> Cette règle s’appliquera dès qu’il sera branché. </> : null}{D.mode === 'none' ? 'Aucun acompte : simple, mais les absences ne coûtent rien au client.' : D.mode === 'all' ? 'Chaque réservation en ligne paie ' + D.percent + ' % à l’avance (5 € minimum).' : 'Exemple : une prestation de ' + eur(Math.max(D.thresholdCents, 6000)) + ' demande ' + eur(Math.max(500, Math.round((Math.max(D.thresholdCents, 6000) * D.percent) / 10000) * 100)) + ' d’acompte. En dessous de ' + eur(D.thresholdCents) + ', rien.'} Une prestation peut avoir sa propre règle dans le Catalogue.</p>
        <Field label="Frais d’absence (carte enregistrée)" hint="Montant prévu pour la carte enregistrée à la réservation (prochaine étape) : rien n’est prélevé pour l’instant." htmlFor="dp-n"><input id="dp-n" className="input" inputMode="decimal" value={(D.noShowFeeCents / 100).toString().replace('.', ',')} onChange={(e) => d.setV({ ...D, noShowFeeCents: Math.min(20000, money.parseEur(e.target.value) ?? 0) })} /></Field>
      </Card>
      <SaveBar dirty={b.dirty || d.dirty} busy={busy} onReset={() => { b.reset(); d.reset(); }} onSave={() => save({ ...(b.dirty ? { booking: B } : {}), ...(d.dirty ? { deposits: D } : {}) }, cgvChanged ? 'Réglages enregistrés, CGV mises à jour' : undefined)} />
    </div>
  );
}
