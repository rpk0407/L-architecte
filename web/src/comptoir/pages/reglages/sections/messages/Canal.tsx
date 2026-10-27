// Canal d'envoi (MSG-02): which way the texts leave (Brevo SMS, the salon's own phone, WhatsApp with SMS as the fallback),
// whether each route is configured (read from the environment by the server: no key, no password ever reaches this page),
// a test to the owner's own phone per route, and the WhatsApp template of each automatic text.
// Saved on its own (settings.messages.whatsapp), so it never mixes with the unsaved texts of the page around it.
// WhatsApp carries service texts only (FID-01): review requests and offers would need the client's own yes to WhatsApp,
// so their rows say « SMS uniquement » and take no template.
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { ago } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/query';
import { Icon } from '../../../../../ui/Icon';
import { Button, Field, Note, Switch, toast, toastError } from '../../../../../ui/kit';
import { useApp } from '../../../../state';
import { Card, useSave, useSection } from '../../shared';
import './canal.css';

type Route = { key: 'brevo' | 'gateway' | 'twilio'; configured: boolean; active: boolean; sender?: string; host?: string };
// utility: a service text, which may go by WhatsApp; sms: a review request or an offer, always by SMS
type Tpl = { key: string; category: 'utility' | 'sms'; vars: string[]; mapped: boolean };
type Trouble = { at: number; error: string; via?: string } | null;
type Channels = {
  mode: 'demo' | 'production'; active: string | null; routes: Route[]; demo: boolean;
  whatsapp: { configured: boolean; live: boolean; enabled: boolean; sender: string; senderInvalid: boolean };
  templates: Tpl[]; vars: string[]; lastFailure: Trouble; lastFallback: Trouble;
};
type Mapping = Record<string, { id: number; params: string[] } | null>;
type Wa = { enabled: boolean; templates: Mapping };
type Row = { id: string; params: string };

/** The SMS provider's name in a sentence ("SMS via le téléphone du salon"). */
export function smsVia(name: string | null | undefined) {
  return name === 'gateway' ? 'le téléphone du salon' : name === 'brevo' ? 'Brevo' : name === 'twilio' ? 'Twilio' : name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}
const ROUTE: Record<string, { t: string; icon: string; env: string; use: string }> = {
  brevo: { t: 'Brevo SMS', icon: 'sms', env: 'BREVO_API_KEY et SMS_SENDER', use: 'SMS_PROVIDER=brevo' },
  gateway: { t: 'Téléphone du salon', icon: 'phone', env: 'SMSGATE_USERNAME et SMSGATE_PASSWORD (l’appli SMS Gateway, onglet Accueil)', use: 'SMS_PROVIDER=gateway' },
  twilio: { t: 'Twilio SMS', icon: 'sms', env: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM', use: 'SMS_PROVIDER=twilio' }
};
const LABEL: Record<string, string> = {
  confirmation: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', review: 'Demande d’avis', rebook: 'Relance',
  waitlist: 'Place libérée', queue: 'Bientôt ton tour', cancelled: 'Annulation', receipt: 'Reçu', lookup: 'Lien Mon rendez-vous',
  giftcardCode: 'Code carte cadeau', reassign: 'Barbier absent, remplacé', reassignAt: 'Barbier absent, autre heure', reschedule: 'Rendez-vous à décaler', giftcard: 'Carte cadeau en ligne'
};
const rowsOf = (m: Mapping): Record<string, Row> => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v && v.id > 0).map(([k, v]) => [k, { id: String(v!.id), params: v!.params.join(', ') }]));
const namesOf = (p: string) => p.split(/[\s,;]+/).map((x) => x.replace(/[{}]/g, '').trim()).filter(Boolean);

export default function Canal({ s }: { s: any }) {
  const { boot, now } = useApp();
  const q = useQuery<Channels>('/api/v1/messages/channels');
  const saved: Wa = { enabled: false, templates: {}, ...((s.messages && s.messages.whatsapp) || {}) };
  const w = useSection<{ enabled: boolean; rows: Record<string, Row> }>({ enabled: !!saved.enabled, rows: rowsOf(saved.templates) });
  const { busy, save } = useSave();
  const [phone, setPhone] = useState(String((boot.settings.notify && boot.settings.notify.phone) || ''));
  const [testing, setTesting] = useState('');
  const d = q.data;
  if (!d) return <Card title="Canal d’envoi" icon="sms"><p className="faint" style={{ fontSize: 13.5 }}>Chargement…</p></Card>;
  const demo = d.mode === 'demo';
  const W = w.v;
  const vars = new Set(d.vars);
  // what is wrong in each row, and in which field: a number that is not one, a variable the server does not fill
  const errs: Record<string, { field: 'id' | 'params'; msg: string }> = {};
  const utility = d.templates.filter((t) => t.category === 'utility');
  const smsOnly = d.templates.filter((t) => t.category !== 'utility');
  for (const [k, r] of Object.entries(W.rows)) {
    if (!utility.some((t) => t.key === k)) continue;
    const id = r.id.trim(), names = namesOf(r.params);
    if (!id && !names.length) continue;
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1) errs[k] = { field: 'id', msg: 'Le numéro du modèle dans Brevo (un nombre).' };
    else if (names.some((n) => !vars.has(n))) errs[k] = { field: 'params', msg: 'Inconnu : ' + names.filter((n) => !vars.has(n)).join(', ') + '.' };
  }
  // the badges say what is saved, not what is being typed
  const waOn = !!saved.enabled && d.templates.some((t) => t.mapped);
  const sms = d.routes.find((r) => r.active);
  const inUse = demo ? 'Démo · simulé' : waOn && d.whatsapp.configured ? 'WhatsApp + SMS en secours' : sms ? ROUTE[sms.key].t : 'Aucun';
  const tone = demo ? 'badge-info' : sms || (waOn && d.whatsapp.configured) ? 'badge-ok' : 'badge-warn';

  const setRow = (k: string, patch: Partial<Row>) => w.setV({ ...W, rows: { ...W.rows, [k]: { ...(W.rows[k] || { id: '', params: '' }), ...patch } } });
  const onSave = async () => {
    const templates: Mapping = {};
    for (const t of d.templates) {
      const r = W.rows[t.key];
      const id = r && t.category === 'utility' ? r.id.trim() : '';
      if (id) templates[t.key] = { id: Number(id), params: namesOf(r!.params) };
      // a row emptied takes the mapping out (null: the server keeps the others)
      else if (saved.templates && saved.templates[t.key]) templates[t.key] = null;
    }
    if (await save({ messages: { whatsapp: { enabled: W.enabled, templates } } }, 'Canal d’envoi enregistré')) void q.refresh();
  };
  const test = async (route: string) => {
    setTesting(route);
    try {
      const r = await api.post<{ simulated: boolean; to: string; template?: string }>('/api/v1/messages/channels/test', { route, ...(phone.trim() ? { phone } : {}) });
      const name = route === 'whatsapp' ? 'WhatsApp' : ROUTE[route].t;
      toast({ title: (r.simulated ? 'Test simulé vers ' : 'Test envoyé au ') + r.to, sub: r.simulated ? 'En démo, rien ne part vraiment.' : name + (r.template ? ', modèle « ' + (LABEL[r.template] || r.template) + ' »' : '') + ' : il arrive dans la minute.', icon: 'sms' });
    } catch (e) { toastError(e); } finally { setTesting(''); }
  };
  const testBtn = (route: string, ok: boolean) => (
    <Button size="sm" variant="subtle" icon="sms" busy={testing === route} disabled={!demo && !ok} onClick={() => void test(route)}>Envoyer un test</Button>
  );
  const fail = d.lastFailure && now() - d.lastFailure.at < 7 * 86400000 ? d.lastFailure : null;
  return (
    <Card title="Canal d’envoi" icon="sms" aside={<span className={'badge ' + tone}>{inUse}</span>}>
      <p className="muted" style={{ fontSize: 13.5 }}>Par où partent les messages automatiques. Le téléphone du salon envoie depuis le vrai numéro du salon, au prix de son forfait, et les clients peuvent y répondre. WhatsApp passe en premier pour les messages qui ont un modèle approuvé ; s’il refuse, le SMS part à la place.</p>
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
          <span className="cn-ic"><Icon name="globe" size={17} /></span>
          <span className="cn-main"><b>WhatsApp</b><small>{d.whatsapp.configured ? 'Depuis ' + d.whatsapp.sender + (waOn ? ', SMS en secours.' : d.templates.some((t) => t.mapped) ? ' : à activer plus bas.' : ' : associe un modèle plus bas, puis teste-le.') : d.whatsapp.senderInvalid ? 'WHATSAPP_SENDER n’est pas un numéro international (+33…).' : demo ? 'Démo : rien ne part.' : 'À brancher : WHATSAPP_SENDER (le numéro WhatsApp Business) avec BREVO_API_KEY.'}</small></span>
          <span className={'badge ' + (d.whatsapp.configured && waOn ? 'badge-ok' : d.whatsapp.configured ? 'badge-info' : '')}>{d.whatsapp.configured && waOn ? 'En service' : d.whatsapp.configured ? 'Prêt' : 'Non branché'}</span>
          {testBtn('whatsapp', d.whatsapp.configured && d.templates.some((t) => t.mapped))}
        </li>
      </ul>
      {fail ? <Note tone="warn" icon="alert">Dernier échec {ago(fail.at, now())}{fail.via === 'whatsapp' ? ' (WhatsApp)' : ''} : {fail.error || 'sans raison donnée'}.</Note> : null}
      {d.lastFallback && now() - d.lastFallback.at < 7 * 86400000 ? <Note icon="info">Dernier passage au SMS {ago(d.lastFallback.at, now())} : {d.lastFallback.error}.</Note> : null}

      <div className="cn-wa">
        <Switch on={W.enabled} onChange={(v) => w.setV({ ...W, enabled: v })} title="Envoyer par WhatsApp quand un modèle est associé" hint="Chaque modèle est validé par Meta dans Brevo (WhatsApp › Modèles). Colle ici son numéro et l’ordre de ses variables. Un message sans modèle part par SMS." />
        {W.enabled && !d.whatsapp.configured && !demo ? <Note tone="warn" icon="alert">WhatsApp n’est pas branché sur ce serveur : les messages partent par SMS tant que <code>WHATSAPP_SENDER</code> manque.</Note> : null}
        <div className="cn-map" role="table" aria-label="Modèles WhatsApp">
          <div className="cn-row cn-head" role="row"><span role="columnheader">Message</span><span role="columnheader">Catégorie Meta</span><span role="columnheader">N° du modèle</span><span role="columnheader">Variables, dans l’ordre</span></div>
          {utility.map((t) => {
            const r = W.rows[t.key] || { id: '', params: '' };
            const err = errs[t.key];
            return (
              <div key={t.key} className="cn-row" role="row">
                <span className="cn-name" role="cell"><b>{LABEL[t.key] || t.key}</b></span>
                <span role="cell"><span className="badge" title="Lié à un rendez-vous ou un achat du client : tarif Utilité">Utilité</span></span>
                <span role="cell"><input className={'input cn-id' + (err && err.field === 'id' ? ' bad' : '')} inputMode="numeric" maxLength={10} placeholder="N° Brevo" aria-label={'Numéro du modèle : ' + (LABEL[t.key] || t.key)} value={r.id} onChange={(e) => setRow(t.key, { id: e.target.value.replace(/\D/g, '') })} /></span>
                <span role="cell" className="cn-vars"><input className={'input' + (err && err.field === 'params' ? ' bad' : '')} maxLength={160} placeholder={t.vars.join(', ')} aria-label={'Variables : ' + (LABEL[t.key] || t.key)} value={r.params} onChange={(e) => setRow(t.key, { params: e.target.value })} />{err ? <small className="cn-err">{err.msg}</small> : null}</span>
              </div>
            );
          })}
          {smsOnly.length ? (
            <div className="cn-row cn-sms" role="row">
              <span className="cn-name" role="cell"><b>{smsOnly.map((t) => LABEL[t.key] || t.key).join(' · ')}</b></span>
              <span role="cell"><span className="badge badge-info">SMS uniquement</span></span>
              <span role="cell" aria-colspan={2} className="cn-why"><small>Demandes d’avis et bons plans : WhatsApp demande l’accord du client, ils partent par SMS.</small></span>
            </div>
          ) : null}
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Variables possibles : {d.vars.map((v) => '{' + v + '}').join(' ')}. Elles remplissent le modèle dans l’ordre : la première pour {'{{1}}'}, la deuxième pour {'{{2}}'}… Les relances écrites à la main restent des SMS.</p>
        {w.dirty ? (
          <div className="cn-save">
            <Button variant="ghost" onClick={w.reset}>Annuler</Button>
            <Button variant="primary" busy={busy} disabled={Object.keys(errs).length > 0} onClick={() => void onSave()}>Enregistrer le canal</Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
