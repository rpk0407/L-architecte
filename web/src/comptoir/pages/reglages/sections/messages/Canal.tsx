// Messages aux clients (MSG-02): one choice, in plain words, of how confirmations, reminders, moves and cancellations
// reach the clients: WhatsApp by hand from the salon's phone (works at once, no account), WhatsApp automatic (Meta's own
// API, no reseller, with four approved templates), or SMS (Brevo, the salon's phone, Twilio). For each way: what is
// plugged in, what is missing, and a test to the owner's own phone or mailbox. The server reads the keys from its
// environment: no key, no password ever reaches this page.
// Saved on its own (settings.messages.whatsapp), so it never mixes with the unsaved texts of the page around it.
// WhatsApp carries service texts only (FID-01): review requests and offers would need the client's own yes to WhatsApp,
// so they stay SMS.
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { ago, plural } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/query';
import { Link } from '../../../../../lib/router';
import { Icon } from '../../../../../ui/Icon';
import { Button, Field, Note, toast, toastError } from '../../../../../ui/kit';
import { useApp } from '../../../../state';
import { Card, useSave, useSection } from '../../shared';
import './canal.css';

type Mode = 'sms' | 'phone' | 'auto';
type Route = { key: 'brevo' | 'gateway' | 'twilio'; configured: boolean; active: boolean; sender?: string; host?: string };
type Trouble = { at: number; error: string; via?: string } | null;
type MetaTpl = { key: string; name: string; lang: string; text: string; params: string[]; mapped: boolean };
type Channels = {
  mode: 'demo' | 'production'; active: string | null; routes: Route[]; demo: boolean;
  whatsapp: { configured: boolean; live: boolean; enabled: boolean; sender: string; senderInvalid: boolean; mode: Mode; effective: Mode; incomplete: boolean; number: string; waiting: number; hold: boolean };
  metaTemplates: MetaTpl[]; waDefaults: Record<string, { name: string; lang: string; params: string[] }>;
  email: { provider: string | null; configured: boolean; kind: string | null; from: string; host: string; incomplete: boolean; fromInvalid: boolean; to: string };
  lastFailure: Trouble; lastFallback: Trouble;
};

/** The SMS provider's name in a sentence ("SMS via le téléphone du salon"). */
export function smsVia(name: string | null | undefined) {
  return name === 'gateway' ? 'le téléphone du salon' : name === 'brevo' ? 'Brevo' : name === 'twilio' ? 'Twilio' : name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}
const ROUTE: Record<string, { t: string; icon: string; env: string; use: string }> = {
  brevo: { t: 'Brevo SMS', icon: 'sms', env: 'BREVO_API_KEY et SMS_SENDER', use: 'SMS_PROVIDER=brevo' },
  gateway: { t: 'Téléphone du salon (SMS)', icon: 'phone', env: 'SMSGATE_USERNAME et SMSGATE_PASSWORD (l’appli SMS Gateway, onglet Accueil)', use: 'SMS_PROVIDER=gateway' },
  twilio: { t: 'Twilio SMS', icon: 'sms', env: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM', use: 'SMS_PROVIDER=twilio' }
};
const TPL_LABEL: Record<string, string> = { confirmation: 'Confirmation', moved: 'Rendez-vous déplacé', reminder: 'Rappel la veille', cancelled: 'Annulation' };
const MODE_WORDS: Record<Mode, string> = { phone: 'WhatsApp, à la main', auto: 'WhatsApp automatique', sms: 'SMS' };
/** A number as typed, good enough to save? (the server decides: a French mobile, or an international number) */
const numberOk = (v: string) => !v.trim() || /^(\+|00)?[\d\s().-]{8,22}$/.test(v.trim());

export default function Canal({ s }: { s: any }) {
  const { boot, now } = useApp();
  const q = useQuery<Channels>('/api/v1/messages/channels');
  const wa = (s.messages && s.messages.whatsapp) || {};
  const savedMode: Mode = wa.mode === 'phone' || wa.mode === 'auto' || wa.mode === 'sms' ? wa.mode : wa.enabled ? 'auto' : 'sms';
  const w = useSection<{ mode: Mode; number: string }>({ mode: savedMode, number: q.data?.whatsapp.number || '' });
  const { busy, save } = useSave();
  const [phone, setPhone] = useState(String((boot.settings.notify && boot.settings.notify.phone) || ''));
  const [testing, setTesting] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Card title="Messages aux clients" icon="sms"><p className="faint" style={{ fontSize: 13.5 }}>Chargement…</p></Card>;
  const demo = d.mode === 'demo';
  const W = w.v;
  const sms = d.routes.find((r) => r.active);
  const eff = d.whatsapp.effective;
  const tone = demo ? 'badge-info' : eff === savedMode ? 'badge-ok' : 'badge-warn';
  const inUse = demo ? 'Démo · simulé' : eff === savedMode ? MODE_WORDS[eff] : MODE_WORDS[eff] + ' (en attendant)';
  const badNumber = !numberOk(W.number);

  const onSave = async () => {
    // the automatic mode comes with its four templates under their names, unless some were already associated
    const fresh = W.mode === 'auto' && !d.metaTemplates.some((t) => t.mapped);
    const patch = { mode: W.mode, enabled: W.mode === 'auto', number: W.number.trim(), ...(fresh ? { templates: d.waDefaults } : {}) };
    if (await save({ messages: { whatsapp: patch } }, 'Messages aux clients : enregistré')) void q.refresh();
  };
  const test = async (route: string) => {
    setTesting(route);
    try {
      if (route === 'email') {
        const r = await api.post<{ simulated: boolean; to: string }>('/api/v1/messages/channels/test-email', {});
        toast({ title: (r.simulated ? 'Test simulé vers ' : 'E-mail test envoyé à ') + r.to, sub: r.simulated ? 'En démo, rien ne part vraiment.' : 'Il arrive dans la minute. Regarde aussi les indésirables.', icon: 'mail' });
      } else {
        const r = await api.post<{ simulated: boolean; to: string; template?: string }>('/api/v1/messages/channels/test', { route, ...(phone.trim() ? { phone } : {}) });
        const name = route === 'whatsapp' ? 'WhatsApp automatique' : ROUTE[route].t;
        toast({ title: (r.simulated ? 'Test simulé vers ' : 'Test envoyé au ') + r.to, sub: r.simulated ? 'En démo, rien ne part vraiment.' : name + (r.template ? ', modèle « ' + (TPL_LABEL[r.template] || r.template) + ' »' : '') + ' : il arrive dans la minute.', icon: 'sms' });
      }
    } catch (e) { toastError(e); } finally { setTesting(''); }
  };
  const testBtn = (route: string, ok: boolean, label = 'Envoyer un test') => (
    <Button size="sm" variant="subtle" icon={route === 'email' ? 'mail' : 'sms'} busy={testing === route} disabled={!demo && !ok} onClick={() => void test(route)}>{label}</Button>
  );
  const fail = d.lastFailure && now() - d.lastFailure.at < 7 * 86400000 ? d.lastFailure : null;

  // what each way needs before it works, in words; '' when it is ready
  const autoMissing = d.whatsapp.live || demo ? '' : d.whatsapp.incomplete ? 'Il manque une des deux clés : WHATSAPP_TOKEN et WHATSAPP_PHONE_ID vont ensemble (dans Vercel).'
    : 'Pas encore branché : il faut un compte Meta Business, un numéro pour l’API et quatre modèles approuvés, puis WHATSAPP_TOKEN et WHATSAPP_PHONE_ID dans Vercel. Le guide docs/messages-whatsapp.md donne les étapes.';
  const smsMissing = sms || demo ? '' : 'Aucun fournisseur SMS branché (voir plus bas).';
  const modes: { k: Mode; t: string; d: string; state: string; ok: boolean }[] = [
    { k: 'phone', t: 'WhatsApp, depuis le téléphone du salon', d: 'Marche dès maintenant, sans compte ni abonnement. Le Comptoir écrit chaque message ; sur l’écran Messages, un bouton ouvre WhatsApp, tu appuies sur Envoyer. Gratuit.', state: 'Prêt.', ok: true },
    { k: 'auto', t: 'WhatsApp automatique', d: 'Les messages partent tout seuls, directement par Meta, sans intermédiaire. Environ 3 centimes par message. À préparer une fois (compte Meta, numéro, modèles).', state: autoMissing || 'Branché' + (d.whatsapp.sender ? ', depuis le ' + d.whatsapp.sender : '') + '.', ok: !autoMissing },
    { k: 'sms', t: 'SMS', d: 'Par un fournisseur (Brevo, payant au SMS) ou par le forfait du téléphone du salon. Les demandes d’avis et les relances restent toujours des SMS.', state: smsMissing || (sms ? 'En service : ' + ROUTE[sms.key].t + '.' : 'Démo : rien ne part.'), ok: !smsMissing }
  ];
  const chosen = modes.find((m) => m.k === W.mode)!;

  return (
    <Card title="Messages aux clients" icon="sms" guide="messages-canal" aside={<span className={'badge ' + tone}>{inUse}</span>}>
      <p className="muted" style={{ fontSize: 13.5 }}>Par où partent la confirmation, le rappel, le déplacement et l’annulation d’un rendez-vous. Les e-mails partent en plus, aux clients qui ont donné leur adresse.</p>
      {d.whatsapp.hold ? <Note tone="warn" icon="lock">Quel que soit le choix, rien ne part vers les clients avant la bascule depuis l’ancien site.</Note> : null}

      <div className="cn-modes" role="radiogroup" aria-label="Comment partent les messages aux clients">
        {modes.map((m) => (
          <label key={m.k} className={'cn-mode' + (W.mode === m.k ? ' on' : '')}>
            <input type="radio" name="cn-mode" value={m.k} checked={W.mode === m.k} onChange={() => w.setV({ ...W, mode: m.k })} />
            <span className="cn-main"><b>{m.t}</b><small>{m.d}</small><small className={m.ok ? 'cn-ok' : 'cn-miss'}><Icon name={m.ok ? 'check' : 'alert'} size={13} />{m.state}</small></span>
          </label>
        ))}
      </div>
      {!chosen.ok && !demo ? <Note icon="info">En attendant, rien n’est perdu : les messages arrivent sur l’écran <Link to="/messages" className="link">Messages</Link>, à envoyer depuis le WhatsApp du salon.</Note> : null}
      {d.whatsapp.waiting ? <Note tone="accent" icon="sms"><Link to="/messages" className="link">{plural(d.whatsapp.waiting, 'message')} à envoyer maintenant</Link> depuis le téléphone du salon.</Note> : null}

      <Field label="Numéro WhatsApp du salon" htmlFor="cn-number" error={badNumber ? 'Numéro invalide' : null} hint="Affiche sur le site, juste après la réservation, le bouton « Recevoir la confirmation sur WhatsApp » : le client t’écrit le premier, tu lui réponds. Vide : pas de bouton.">
        <input id="cn-number" className="input" type="tel" inputMode="tel" maxLength={24} placeholder="06 12 34 56 78" value={W.number} onChange={(e) => w.setV({ ...W, number: e.target.value.replace(/[^\d +().-]/g, '') })} />
      </Field>
      {w.dirty ? (
        <div className="cn-save">
          <Button variant="ghost" onClick={w.reset}>Annuler</Button>
          <Button variant="primary" busy={busy} disabled={badNumber} onClick={() => void onSave()}>Enregistrer</Button>
        </div>
      ) : null}

      {W.mode === 'auto' || savedMode === 'auto' ? (
        <div className="cn-wa">
          <p className="section-k">Les quatre modèles à créer chez Meta</p>
          <p className="faint" style={{ fontSize: 12.5 }}>Dans WhatsApp Manager › Modèles de message : catégorie « Utilitaire », langue « Français », variables par nom. Le nom et le texte doivent être exactement ceux-ci.</p>
          <ul className="list">
            {d.metaTemplates.map((t) => (
              <li key={t.key} className="cn-tpl">
                <button type="button" className="li" aria-expanded={shown === t.key} onClick={() => setShown(shown === t.key ? null : t.key)}>
                  <span className="li-main"><b>{TPL_LABEL[t.key] || t.key}</b><small><code>{t.name}</code> · {t.mapped ? 'associé' : 'pas encore associé'}</small></span>
                  <Icon name={shown === t.key ? 'chevD' : 'chevR'} size={16} />
                </button>
                {shown === t.key ? <div className="bubble"><small>Texte à coller chez Meta</small><p>{t.text}</p></div> : null}
              </li>
            ))}
          </ul>
          <div className="cn-test">{testBtn('whatsapp', d.whatsapp.live && d.metaTemplates.some((t) => t.mapped), 'Tester WhatsApp automatique')}</div>
        </div>
      ) : null}

      <p className="section-k" style={{ marginTop: 6 }}>Ce qui est branché</p>
      <Field label="Ton portable, pour les tests" htmlFor="cn-phone" hint="Vide : le numéro de « Me prévenir », ou celui du salon si c’est un portable.">
        <input id="cn-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="06 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d +().-]/g, ''))} />
      </Field>
      <ul className="cn-routes">
        {d.routes.map((r) => {
          const R = ROUTE[r.key];
          const line = r.active ? 'En service' + (r.key === 'brevo' && r.sender ? ', expéditeur « ' + r.sender + ' »' : r.key === 'gateway' && r.host && r.host !== 'api.sms-gate.app' ? ' (' + r.host + ')' : '') + '.'
            : r.configured ? 'Prêt. Pour l’utiliser : ' + R.use + ' dans Vercel, puis redéploie.'
              : demo ? 'Démo : rien ne part.' : 'À brancher : ' + R.env + ' dans Vercel.';
          return (
            <li key={r.key} className="cn-route">
              <span className="cn-ic"><Icon name={R.icon} size={17} /></span>
              <span className="cn-main"><b>{R.t}</b><small>{line}</small></span>
              <span className={'badge ' + (r.active ? 'badge-ok' : r.configured ? 'badge-info' : '')}>{r.active ? 'En service' : r.configured ? 'Prêt' : 'Non branché'}</span>
              {testBtn(r.key, r.configured)}
            </li>
          );
        })}
        <li className="cn-route">
          <span className="cn-ic"><Icon name="mail" size={17} /></span>
          <span className="cn-main"><b>E-mail</b><small>{d.email.provider === 'smtp' ? 'Par la boîte du salon (' + d.email.host + '), expéditeur ' + d.email.from + '.'
            : d.email.provider ? 'Par ' + smsVia(d.email.provider) + ', expéditeur ' + d.email.from + '.'
              : demo ? 'Démo : rien ne part.'
                : d.email.fromInvalid ? 'EMAIL_FROM n’est pas une adresse valide.'
                  : d.email.incomplete ? 'SMTP_HOST est là, il manque SMTP_USER ou SMTP_PASS.'
                    : 'À brancher sur la boîte du salon : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et EMAIL_FROM dans Vercel.'}</small></span>
          <span className={'badge ' + (d.email.provider ? 'badge-ok' : '')}>{d.email.provider ? 'En service' : 'Non branché'}</span>
          {testBtn('email', !!d.email.provider, 'Envoyer un e-mail test')}
        </li>
      </ul>
      {fail ? <Note tone="warn" icon="alert">Dernier échec {ago(fail.at, now())}{fail.via === 'whatsapp' ? ' (WhatsApp)' : ''} : {fail.error || 'sans raison donnée'}.</Note> : null}
      {d.lastFallback && now() - d.lastFallback.at < 7 * 86400000 ? <Note icon="info">Dernier message que WhatsApp automatique n’a pas pris {ago(d.lastFallback.at, now())} : {d.lastFallback.error}.</Note> : null}
    </Card>
  );
}
