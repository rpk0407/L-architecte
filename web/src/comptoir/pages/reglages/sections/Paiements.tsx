// Paiements: what the till accepts, tips, default VAT, and whether online payments are real.
import { money } from '../../../../lib/format';
import { Chip, Field, Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

export default function Paiements({ s }: SectionProps) {
  const { boot } = useApp();
  const p = useSection(s.payments);
  const { busy, save } = useSave();
  const P = p.v;
  const prov = boot.providers;
  const webhook = location.origin + '/api/stripe/webhook';
  // production without Stripe: nothing is simulated there, online payment is simply off
  const off = boot.mode !== 'demo' && prov.payments === 'simulated';
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Moyens acceptés à la caisse" icon="caisse">
        <Switch on={P.card} onChange={(v) => p.setV({ ...P, card: v })} title="Carte bancaire (terminal)" hint="Le montant est saisi sur ton terminal ; la caisse l’enregistre." />
        <Switch on={P.cash} onChange={(v) => p.setV({ ...P, cash: v })} title="Espèces" hint="Rendu de monnaie calculé, tiroir compté le soir." />
        <Switch on={P.qr} onChange={(v) => p.setV({ ...P, qr: v })} title="QR code" hint={off ? 'Nécessite Stripe : désactivé tant qu’il n’est pas branché.' : 'Le client scanne et paie sur son téléphone (Apple Pay, carte). Sans terminal.'} />
        <Switch on={P.giftcard} onChange={(v) => p.setV({ ...P, giftcard: v })} title="Cartes cadeaux" />
      </Card>
      <Card title="Pourboires et TVA" icon="heart">
        <Switch on={P.tips} onChange={(v) => p.setV({ ...P, tips: v })} title="Proposer un pourboire" hint="Versé au barbier, hors chiffre d’affaires et hors TVA." />
        {P.tips ? <Field label="Montants proposés (€)"><div className="chips">{P.tipPresets.map((t: number, i: number) => <input key={i} className="input ct-num" inputMode="decimal" value={(t / 100).toString().replace('.', ',')} onChange={(e) => p.setV({ ...P, tipPresets: P.tipPresets.map((x: number, j: number) => (j === i ? money.parseEur(e.target.value) ?? 0 : x)) })} aria-label={'Pourboire ' + (i + 1)} />)}</div></Field> : null}
        <Field label="TVA par défaut des nouvelles prestations"><div className="chips">{[2000, 1000, 550].map((v) => <Chip key={v} small on={P.vat === v} onClick={() => p.setV({ ...P, vat: v })}>{v / 100} %</Chip>)}</div></Field>
      </Card>
      <Card title="Paiement en ligne" icon="globe" aside={<span className={'badge ' + (prov.paymentsLive ? 'badge-ok' : prov.payments === 'stripe' ? 'badge-info' : 'badge-warn')}>{prov.paymentsLive ? 'Stripe · réel' : prov.payments === 'stripe' ? 'Stripe · test' : off ? 'Non branché' : 'Simulé'}</span>}>
        {prov.payments === 'stripe' ? (
          <p className="muted" style={{ fontSize: 13.5 }}>Les acomptes et les QR codes passent par Stripe. L’argent arrive sur ton compte Stripe puis sur ton compte bancaire ; les remboursements se font depuis le ticket.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13.5 }}>{off ? 'Paiement en ligne non branché : aucun acompte n’est demandé et le QR est désactivé. Branche Stripe pour les activer.' : 'Démo : les paiements en ligne sont simulés, personne n’est débité.'}</p>
            {off ? <Note icon="info">Pour l’activer : crée un compte Stripe, puis ajoute dans Vercel les variables <code>STRIPE_SECRET_KEY</code> et <code>STRIPE_WEBHOOK_SECRET</code>. Adresse du webhook à déclarer chez Stripe : <code>{webhook}</code> (événements <code>checkout.session.completed</code> et <code>checkout.session.expired</code>).</Note> : null}
          </>
        )}
      </Card>
      <SaveBar dirty={p.dirty} busy={busy} onReset={p.reset} onSave={() => save({ payments: P })} />
    </div>
  );
}
