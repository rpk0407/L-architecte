// Paiements: what the till accepts, tips, default VAT, and whether online payments are real; the webhook to declare
// at Stripe, with every event the payment core handles (payments/handlers.js), in one block to copy.
import type { CSSProperties } from 'react';
import { money } from '../../../../lib/format';
import { copyText } from '../../../../lib/clipboard';
import { navigate } from '../../../../lib/router';
import { Button, Chip, Field, Note, Switch, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

/** The events to tick on Stripe's webhook endpoint, one line per package that handles more (PAY-03 adds its billing ones). */
const WEBHOOK_EVENTS = [
  'checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed', 'payout.paid', 'payout.reconciliation_completed',
  // PAY-03: the monthly memberships, billed by Stripe Billing
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', 'customer.subscription.updated', 'customer.subscription.deleted'
];
/** the events box as tall as its lines, wrapped ones too (a phone): no inner scroll where the browser can (rows otherwise) */
const FIT = { fieldSizing: 'content' } as CSSProperties;
/** a 44 px target for the icon buttons */
const TAP = { '--h': '44px' } as CSSProperties;
const copy = (text: string, what: string) => copyText(text).then(() => toast({ title: what + ' copiée', icon: 'copy' }), toastError);

export default function Paiements({ s }: SectionProps) {
  const { boot } = useApp();
  const p = useSection(s.payments);
  const { busy, save } = useSave();
  const P = p.v;
  const prov = boot.providers;
  const webhook = location.origin + '/api/pay/stripe/webhook';
  // one a line: the owner ticks them one by one in Stripe's list, and the box shows them all without an inner scroll, even on a phone
  const events = WEBHOOK_EVENTS.join('\n');
  // production without Stripe: nothing is simulated there, online payment is simply off
  const off = boot.mode !== 'demo' && prov.payments === 'simulated';
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Moyens acceptés à la caisse" guide="paiements-moyens" icon="caisse">
        <Switch on={P.card} onChange={(v) => p.setV({ ...P, card: v })} title="Carte bancaire (terminal)" hint="Le montant est saisi sur ton terminal ; la caisse l’enregistre." />
        <Switch on={P.cash} onChange={(v) => p.setV({ ...P, cash: v })} title="Espèces" hint="Rendu de monnaie calculé, tiroir compté le soir." />
        <Switch on={P.qr} onChange={(v) => p.setV({ ...P, qr: v })} title="QR code" hint={off ? 'Nécessite Stripe : désactivé tant qu’il n’est pas branché.' : 'Le client scanne et paie sur son téléphone (Apple Pay, carte). Sans terminal.'} />
        <Switch on={P.giftcard} onChange={(v) => p.setV({ ...P, giftcard: v })} title="Cartes cadeaux" />
      </Card>
      <Card title="Pourboires et TVA" guide="paiements-pourboires" icon="heart">
        <Switch on={P.tips} onChange={(v) => p.setV({ ...P, tips: v })} title="Proposer un pourboire" hint="Versé au barbier, hors chiffre d’affaires et hors TVA." />
        {P.tips ? <Field label="Montants proposés (€)"><div className="chips">{P.tipPresets.map((t: number, i: number) => <input key={i} className="input ct-num" inputMode="decimal" value={(t / 100).toString().replace('.', ',')} onChange={(e) => p.setV({ ...P, tipPresets: P.tipPresets.map((x: number, j: number) => (j === i ? money.parseEur(e.target.value) ?? 0 : x)) })} aria-label={'Pourboire ' + (i + 1)} />)}</div></Field> : null}
        <Field label="TVA par défaut des nouvelles prestations"><div className="chips">{[2000, 1000, 550].map((v) => <Chip key={v} small on={P.vat === v} onClick={() => p.setV({ ...P, vat: v })}>{v / 100} %</Chip>)}</div></Field>
      </Card>
      <Card title="Paiement en ligne" guide="paiements-stripe" icon="globe" aside={<span className={'badge ' + (prov.paymentsLive ? 'badge-ok' : prov.payments === 'stripe' ? 'badge-info' : 'badge-warn')}>{prov.paymentsLive ? 'Stripe · réel' : prov.payments === 'stripe' ? 'Stripe · test' : off ? 'Non branché' : 'Simulé'}</span>}>
        {prov.payments === 'stripe' ? (
          <p className="muted" style={{ fontSize: 13.5 }}>Les acomptes et les QR codes passent par Stripe. L’argent arrive sur ton compte Stripe puis sur ton compte bancaire ; les remboursements se font depuis le ticket.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13.5 }}>{off ? 'Paiement en ligne non branché : aucun acompte n’est demandé et le QR est désactivé. Branche Stripe pour les activer.' : 'Démo : les paiements en ligne sont simulés, personne n’est débité.'}</p>
            {off ? <Note icon="info">Pour l’activer : crée un compte Stripe, puis ajoute dans Vercel les variables <code>STRIPE_SECRET_KEY</code> et <code>STRIPE_WEBHOOK_SECRET</code> (le secret du webhook ci-dessous).</Note> : null}
          </>
        )}
        <div className="col" style={{ gap: 10 }}>
          <p className="section-k">Webhook à déclarer chez Stripe</p>
          <Field label="Adresse du webhook" htmlFor="pay-wh">
            <div className="row" style={{ gap: 8 }}><input id="pay-wh" className="input grow" readOnly value={webhook} onFocus={(e) => e.target.select()} /><Button icon="copy" style={TAP} aria-label="Copier l’adresse" onClick={() => copy(webhook, 'Adresse')} /></div>
          </Field>
          <Field label="Événements à cocher" htmlFor="pay-ev" hint="Les paiements, les remboursements faits chez Stripe, les litiges, les virements (avec leurs frais) et les mois d’abonnement arrivent alors d’eux-mêmes dans la Caisse. Garde les virements automatiques quotidiens.">
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}><textarea id="pay-ev" className="input textarea grow" rows={WEBHOOK_EVENTS.length} style={FIT} readOnly value={events} onFocus={(e) => e.target.select()} /><Button icon="copy" style={TAP} aria-label="Copier les événements" onClick={() => copy(events, 'Liste')} /></div>
          </Field>
          <div><Button variant="ghost" icon="card" onClick={() => navigate('/caisse?enligne=1')}>Voir les paiements et virements</Button></div>
        </div>
      </Card>
      <SaveBar dirty={p.dirty} busy={busy} onReset={p.reset} onSave={() => save({ payments: P })} />
    </div>
  );
}
