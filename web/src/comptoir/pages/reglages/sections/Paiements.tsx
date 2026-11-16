// Paiements: what the till accepts, tips, default VAT, and whether online payments are real; Stripe's setup in three
// steps (the account, the two keys in Vercel, the webhook with every event the payment core handles, payments/handlers.js),
// each with its live state. No secret is ever shown or typed here: only the names of the two variables.
import type { CSSProperties } from 'react';
import { ago, money } from '../../../../lib/format';
import { useQuery } from '../../../../lib/query';
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

type StripeHealth = { provider: string; live: boolean; lastWebhook: number | null; state?: 'demo' | 'off' | 'no_webhook_secret' | 'test' | 'live' };
type StepState = 'todo' | 'test' | 'ok' | 'demo';
/** The three steps' states: the account (a key proves it), the two keys in Vercel, the webhook (a notice received proves it). */
export function stripeSteps(h: StripeHealth | undefined, demo: boolean): [StepState, StepState, StepState] {
  if (demo || !h || h.state === 'demo') return ['demo', 'demo', 'demo'];
  const key = h.state !== 'off';
  const both = h.state === 'test' || h.state === 'live';
  const mode: StepState = h.state === 'test' ? 'test' : 'ok';
  return [key ? mode : 'todo', both ? mode : 'todo', both && h.lastWebhook ? mode : 'todo'];
}
const STEP_WORD: Record<StepState, string> = { todo: 'À faire', test: 'Mode test', ok: 'OK', demo: 'Démo' };
const StepBadge = ({ s }: { s: StepState }) => <span className={'badge ' + (s === 'ok' ? 'badge-ok' : s === 'todo' ? 'badge-warn' : 'badge-info')}>{STEP_WORD[s]}</span>;

export default function Paiements({ s }: SectionProps) {
  const { boot, now } = useApp();
  const p = useSection(s.payments);
  const { busy, save } = useSave();
  const P = p.v;
  const prov = boot.providers;
  const webhook = location.origin + '/api/pay/stripe/webhook';
  // one a line: the owner ticks them one by one in Stripe's list, and the box shows them all without an inner scroll, even on a phone
  const events = WEBHOOK_EVENTS.join('\n');
  // production without Stripe: nothing is simulated there, online payment is simply off
  const off = boot.mode !== 'demo' && prov.payments === 'simulated';
  // each step's live state, from the same answer as Mise en route (GET /api/v1/health): no key is ever read here
  const st = useQuery<{ stripe: StripeHealth }>('/api/v1/health').data?.stripe;
  const steps = stripeSteps(st, boot.mode === 'demo');
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Moyens acceptés à la caisse" guide="paiements-moyens" icon="caisse">
        <Switch on={P.card} onChange={(v) => p.setV({ ...P, card: v })} title="Carte bancaire (terminal)" hint="Le montant est saisi sur ton terminal ; la caisse l’enregistre." />
        <Switch on={P.cash} onChange={(v) => p.setV({ ...P, cash: v })} title="Espèces" hint="Rendu de monnaie calculé, tiroir compté le soir." />
        <Switch on={P.qr} onChange={(v) => p.setV({ ...P, qr: v })} title="QR code" hint={off ? 'Nécessite Stripe : désactivé tant qu’il n’est pas branché.' : 'Le client scanne et paie sur son téléphone (Apple Pay, carte). Sans terminal.'} />
        <Switch on={!off && !!P.selfPay} disabled={off} onChange={(v) => p.setV({ ...P, selfPay: v })} title="Le client peut payer sa coupe en ligne" hint={off ? 'Nécessite Stripe : éteint tant qu’il n’est pas branché.' : 'Au salon, une fois arrivé ou sa coupe finie : il règle sur sa page de rendez-vous (carte, Apple Pay, Google Pay), pourboire compris s’il le veut. Ton écran passe à « Payé en ligne » tout seul.'} />
        <Switch on={P.giftcard} onChange={(v) => p.setV({ ...P, giftcard: v })} title="Cartes cadeaux" />
      </Card>
      <Card title="Pourboires et TVA" guide="paiements-pourboires" icon="heart">
        <Switch on={P.tips} onChange={(v) => p.setV({ ...P, tips: v })} title="Proposer un pourboire" hint="Versé au barbier, hors chiffre d’affaires et hors TVA." />
        {P.tips ? <Field label="Montants proposés (€)"><div className="chips">{P.tipPresets.map((t: number, i: number) => <input key={i} className="input ct-num" inputMode="decimal" value={(t / 100).toString().replace('.', ',')} onChange={(e) => p.setV({ ...P, tipPresets: P.tipPresets.map((x: number, j: number) => (j === i ? money.parseEur(e.target.value) ?? 0 : x)) })} aria-label={'Pourboire ' + (i + 1)} />)}</div></Field> : null}
        <Field label="TVA par défaut des nouvelles prestations"><div className="chips">{[2000, 1000, 550].map((v) => <Chip key={v} small on={P.vat === v} onClick={() => p.setV({ ...P, vat: v })}>{String(v / 100).replace('.', ',')} %</Chip>)}</div></Field>
      </Card>
      <Card title="Paiement en ligne" guide="paiements-stripe" icon="globe" aside={<span className={'badge ' + (prov.paymentsLive ? 'badge-ok' : prov.payments === 'stripe' ? 'badge-info' : 'badge-warn')}>{prov.paymentsLive ? 'Stripe · réel' : prov.payments === 'stripe' ? 'Stripe · test' : off ? 'Non branché' : 'Simulé'}</span>}>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {prov.payments === 'stripe' ? 'Les acomptes, la formule et les QR codes passent par Stripe. L’argent arrive sur ton compte Stripe puis sur ton compte bancaire ; les remboursements se font depuis le ticket.'
            : off ? 'Pas encore branché : aucun acompte n’est demandé en ligne et le QR de la caisse est éteint. Les trois étapes ci-dessous le mettent en route.' : 'Démo : les paiements en ligne sont simulés, personne n’est débité.'}
        </p>
        <Note icon="card"><b>Carte, Apple Pay, Google Pay. Pas de PayPal.</b> Le client paie sur la page sécurisée de Stripe : Apple Pay s’affiche sur iPhone et Safari, Google Pay sur Android et Chrome, la carte partout. PayPal n’est jamais proposé, même s’il est coché chez Stripe.</Note>
        <div className="col" style={{ gap: 12 }} data-guide="paiements-etapes">
          <p className="section-k">Brancher Stripe en 3 étapes</p>
          <ol className="pay-steps">
            <li data-state={steps[0]}>
              <div className="pay-step-h"><b>1. Ton compte Stripe</b><StepBadge s={steps[0]} /></div>
              <p className="muted">Crée le compte sur stripe.com au nom du salon et termine l’activation (pièce d’identité, IBAN). Dans Stripe › Paramètres › Moyens de paiement, laisse cochés <b>Cartes</b>, <b>Apple Pay</b> et <b>Google Pay</b>. Rien d’autre à cocher.</p>
            </li>
            <li data-state={steps[1]}>
              <div className="pay-step-h"><b>2. Deux clés dans Vercel</b><StepBadge s={steps[1]} /></div>
              <p className="muted">Dans Vercel › ton projet › Settings › Environment Variables, ajoute ces deux noms avec leur valeur prise chez Stripe, puis redéploie. La première est la clé secrète (Stripe › Développeurs › Clés API), la seconde s’affiche à l’étape 3.{st?.state === 'no_webhook_secret' ? ' La première est posée, il manque la seconde.' : st?.state === 'test' ? ' Ce sont des clés de test : aucun argent ne bouge. Remplace-les par les clés réelles avant d’ouvrir.' : ''}</p>
              {['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].map((k) => (
                <div key={k} className="row" style={{ gap: 8 }}><input className="input grow" readOnly value={k} aria-label={'Nom de la clé ' + k} onFocus={(e) => e.target.select()} /><Button icon="copy" style={TAP} aria-label={'Copier ' + k} onClick={() => copy(k, 'Nom de la clé')} /></div>
              ))}
              <p className="faint" style={{ fontSize: 13 }}>Les valeurs ne se collent que dans Vercel : jamais ici, jamais par message.</p>
            </li>
            <li data-state={steps[2]}>
              <div className="pay-step-h"><b>3. L’adresse où Stripe prévient le salon</b><StepBadge s={steps[2]} /></div>
              <p className="muted">Dans Stripe › Développeurs › Webhooks › Ajouter une destination : colle l’adresse, coche les événements de la liste, valide. Stripe affiche alors le « secret de signature » : c’est la seconde clé de l’étape 2.{st?.lastWebhook ? ' Dernier retour de Stripe ' + ago(st.lastWebhook, now()) + '.' : prov.payments === 'stripe' ? ' Stripe n’a encore rien renvoyé : fais un acompte de 1 €, puis rembourse-le.' : ''}</p>
              <Field label="Adresse à coller chez Stripe" htmlFor="pay-wh">
                <div className="row" style={{ gap: 8 }}><input id="pay-wh" className="input grow" readOnly value={webhook} onFocus={(e) => e.target.select()} /><Button icon="copy" style={TAP} aria-label="Copier l’adresse" onClick={() => copy(webhook, 'Adresse')} /></div>
              </Field>
              <Field label="Événements à cocher" htmlFor="pay-ev" hint="Les paiements, les remboursements faits chez Stripe, les litiges, les virements (avec leurs frais) et les mois d’abonnement arrivent alors d’eux-mêmes dans la Caisse. Garde les virements automatiques quotidiens.">
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}><textarea id="pay-ev" className="input textarea grow" rows={WEBHOOK_EVENTS.length} style={FIT} readOnly value={events} onFocus={(e) => e.target.select()} /><Button icon="copy" style={TAP} aria-label="Copier les événements" onClick={() => copy(events, 'Liste')} /></div>
              </Field>
            </li>
          </ol>
          <div><Button variant="ghost" icon="card" onClick={() => navigate('/caisse?enligne=1')}>Voir les paiements et virements</Button></div>
        </div>
      </Card>
      <SaveBar dirty={p.dirty} busy={busy} onReset={p.reset} onSave={() => save({ payments: P })} />
    </div>
  );
}
