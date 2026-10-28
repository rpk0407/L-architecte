// Avis Google (Réglages › Messages): the request after each finished and paid visit, its delay, the Google link it leads
// to through /avis/… (one value, shop.reviewUrl: Le salon no longer asks for it), a look at the link and a test to the
// owner. The same request goes to every client, never only the happy ones: server/commands/reviews.js says why.
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { plural } from '../../../../../lib/format';
import { REVIEW_HOWTO, REVIEW_KIND, reviewLinkKind, sampleReviewLink } from '../../../../../lib/reviews';
import { Icon } from '../../../../../ui/Icon';
import { Button, Field, Note, Switch, toast, toastError } from '../../../../../ui/kit';
import { useApp } from '../../../../state';
import { smsSegments } from '../../../Relances';
import { Card, useSave, useSection, type SectionProps } from '../../shared';
import './avis.css';

const DELAYS = [30, 60, 120, 240, 1440];
const delayWords = (n: number) => (n < 60 ? n + ' min' : n === 1440 ? 'le lendemain' : n / 60 + ' h');
const SAMPLE: Record<string, string> = { prenom: 'Karim', date: 'Jeu. 12 nov.', heure: '14 h 30', barbier: 'JKut', prestation: 'Coupe classique', prix: '20 €', salon: 'Barber L’Architecte', lien: '' };
/** The text as the server renders it (domain/messages.js renderTemplate), with a link as long as a real one. */
function rendered(tpl: string, link: string) {
  return tpl.replace(/\{(\w+)\}/g, (x: string, k: string) => (k === 'avis' ? link : SAMPLE[k] ?? x)).replace(/\s+/g, ' ')
    .replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').trim();
}

export default function Avis({ s, data }: SectionProps) {
  const { boot } = useApp();
  const f = useSection({ review: !!s.messages.review, delay: Number(s.messages.reviewDelayMin) || 120, url: String(s.shop.reviewUrl || ''), text: String((s.messages.templates || {}).review || '') });
  const v = f.v;
  const { busy, save } = useSave();
  const [phone, setPhone] = useState(String((boot.settings.notify && boot.settings.notify.phone) || ''));
  const [sending, setSending] = useState(false);
  const url = v.url.trim();
  const kind = reviewLinkKind(url);
  const urlErr = !url ? 'Colle le lien de ta fiche Google.' : !/^https:\/\/\S+$/.test(url) ? 'Une adresse qui commence par https://' : null;
  const sms = rendered(v.text, sampleReviewLink(location.origin));
  const seg = smsSegments(sms);
  const noLink = !v.text.includes('{avis}');
  const def = data.defaultTemplates.review || '';

  const onSave = () => {
    const messages: Record<string, unknown> = {};
    if (v.review !== !!s.messages.review) messages.review = v.review;
    if (v.delay !== Number(s.messages.reviewDelayMin)) messages.reviewDelayMin = v.delay;
    if (v.text !== (s.messages.templates || {}).review) messages.templates = { review: v.text };
    void save({ ...(Object.keys(messages).length ? { messages } : {}), ...(url !== s.shop.reviewUrl ? { shop: { reviewUrl: url } } : {}) });
  };
  const sendTest = async () => {
    setSending(true);
    try {
      const r = await api.post<{ channel: 'sms' | 'email'; to: string; status: string; simulated: boolean }>('/api/v1/reviews/test', phone.trim() ? { phone } : {});
      const what = r.channel === 'email' ? 'E-mail' : 'SMS';
      toast(r.simulated ? { title: what + ' de test simulé vers ' + r.to, sub: 'En démo, rien ne part vraiment. Son lien passe par /avis/, puis ta page Google.', icon: 'star' }
        : r.status === 'sent' ? { title: what + ' de test envoyé au ' + r.to, sub: 'Ouvre son lien : il doit mener à ta page d’avis Google.', icon: 'star' }
          : { title: what + ' de test en file d’attente', sub: 'Il part avec les prochains envois (Relances › Envoyés).', icon: 'clock' });
    } catch (e) { toastError(e); } finally { setSending(false); }
  };

  return (
    <Card title="Avis Google" guide="messages-avis" icon="star" aside={<span className={'badge ' + (v.review && kind ? 'badge-ok' : v.review ? 'badge-warn' : '')}>{v.review ? (kind ? 'actif' : 'lien à vérifier') : 'coupé'}</span>}>
      <Switch on={v.review} onChange={(x) => f.setV({ ...v, review: x })} title="Demander un avis après chaque visite" hint="Une fois la visite terminée et encaissée, une fois par trimestre au plus par client. Par SMS, ou par e-mail s’il n’a pas laissé de numéro. Un client qui a répondu STOP ou refusé les SMS n’en reçoit pas." />
      <div className="grid2 stack">
        <Field label="Envoyé après la visite" htmlFor="av-delay" hint="La nuit, le dimanche et les jours fériés, il part le matin suivant.">
          <select id="av-delay" className="input select" value={v.delay} onChange={(e) => f.setV({ ...v, delay: Number(e.target.value) })}>{DELAYS.map((n) => <option key={n} value={n}>{delayWords(n)}</option>)}</select>
        </Field>
        <Field label="Lien Google" htmlFor="av-url" error={urlErr} hint={urlErr ? undefined : kind ? 'Ouvre ' + REVIEW_KIND[kind] + '.' : REVIEW_HOWTO + '.'}>
          <input id="av-url" className="input" type="url" inputMode="url" maxLength={300} placeholder="https://g.page/r/…/review" value={v.url} onChange={(e) => f.setV({ ...v, url: e.target.value })} aria-invalid={urlErr ? true : undefined} />
        </Field>
      </div>
      {url && !urlErr && !kind ? <Note tone="warn" icon="alert">Ce lien n’ouvre pas le formulaire d’avis : le client devrait encore chercher où écrire. {REVIEW_HOWTO}, puis colle-le ici.</Note> : null}
      <div className="av-acts">
        {url && !urlErr ? <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noopener">Tester le lien<Icon name="ext" size={14} /></a> : null}
        <form className="av-test" onSubmit={(e) => { e.preventDefault(); void sendTest(); }}>
          <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Ton portable, 06 …" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Ton portable, pour le test" />
          <Button type="submit" size="sm" variant="subtle" icon="sms" busy={sending} disabled={f.dirty || !s.shop.reviewUrl} title={f.dirty ? 'Enregistre d’abord' : undefined}>Envoyer un test</Button>
        </form>
      </div>
      <div className="bubble"><small>Ce que reçoit Karim · {seg.chars} caractères avec le lien · {plural(seg.count, 'SMS')}</small><p>{sms}</p></div>
      {noLink || seg.count > 1 ? (
        <Note tone="warn" icon="alert">
          {noLink ? <>Le texte n’a pas <code>{'{avis}'}</code> : le client ne recevrait pas le lien. </> : <>Avec le lien, ce texte fait {plural(seg.count, 'SMS')}. </>}
          {v.text !== def ? <button type="button" className="link" onClick={() => f.setV({ ...v, text: def })}>Reprendre le texte conseillé</button> : null}
        </Note>
      ) : <p className="faint av-tip">Le texte se modifie dans « Les textes », plus bas.</p>}
      <Note icon="shield">Le même message part à chaque client, sans question « content ou pas » : Google et la loi interdisent de trier les avis ou de les récompenser. Le lien passe par ton site, qui compte les ouvertures (Rapports › Avis Google) puis ouvre ta page Google.</Note>
      {f.dirty ? (
        <div className="av-save">
          <span className="grow faint">Avis Google modifié</span>
          <Button variant="ghost" size="sm" onClick={f.reset}>Annuler</Button>
          <Button variant="primary" size="sm" busy={busy} disabled={!!urlErr} onClick={onSave}>Enregistrer</Button>
        </div>
      ) : null}
    </Card>
  );
}
