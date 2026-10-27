// Messages: which SMS go out on their own, when, and the owner's version of each text with a live preview;
// the clients' e-mails and what the owner is told (Me prévenir: alerts, the evening summary, Monday's report).
import { useState } from 'react';
import { cap, plural, time } from '../../../../lib/format';
import { useQuery } from '../../../../lib/query';
import { Icon } from '../../../../ui/Icon';
import { Field, Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { quietWords, smsSegments, withStop } from '../../Relances';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

const TPL: { k: string; t: string; when: string; vars: string[] }[] = [
  { k: 'confirmation', t: 'Confirmation', when: 'dès la réservation', vars: ['prenom', 'date', 'heure', 'barbier', 'prestation', 'lien'] },
  { k: 'reminder', t: 'Rappel la veille', when: 'la veille à l’heure choisie', vars: ['prenom', 'heure', 'barbier', 'lien'] },
  { k: 'reminder2h', t: 'Rappel 2 h avant', when: 'deux heures avant', vars: ['prenom', 'heure', 'barbier'] },
  { k: 'review', t: 'Demande d’avis', when: 'après la visite', vars: ['prenom', 'avis'] },
  { k: 'rebook', t: 'Relance', when: 'quand tu l’envoies', vars: ['prenom', 'jours', 'lien'] },
  { k: 'waitlist', t: 'Place libérée', when: 'à une annulation', vars: ['date', 'heure', 'barbier', 'lien'] },
  { k: 'queue', t: 'Bientôt ton tour', when: 'file sans rendez-vous', vars: ['prenom'] },
  { k: 'cancelled', t: 'Annulation', when: 'quand le salon annule', vars: ['date', 'heure', 'lien'] },
  { k: 'receipt', t: 'Reçu', when: 'à la demande, après encaissement', vars: ['prenom', 'ticket', 'montant', 'lien'] }
];
type Notify = { to: string; phone: string; newBooking: boolean; cancel: boolean; evening: string; weekly: boolean };
const NOTIFY: Notify = { to: '', phone: '', newBooking: true, cancel: true, evening: '20:00', weekly: true };
const EVENINGS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** The server's normPhone: a French mobile or landline, or an international number with its +. */
function phoneOk(v: string) {
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+33')) d = '0' + d.slice(3);
  return d.startsWith('+') ? /^\+\d{8,15}$/.test(d) : /^0[1-9]\d{8}$/.test(d);
}
const SAMPLE: Record<string, string> = { prenom: 'Karim', date: 'jeudi 12 novembre', heure: '14 h 30', barbier: 'JKut', prestation: 'Coupe + taille de barbe', lien: 'https://larchitecte.fr/r/LA-7K2P', avis: 'https://g.page/r/…', jours: '34', ticket: 'T001042', montant: '30,00 €' };

export default function Messages({ s, data }: SectionProps) {
  const { boot } = useApp();
  const defaults = data.defaultTemplates;
  const m = useSection(s.messages);
  const { busy, save } = useSave();
  const [open, setOpen] = useState<string | null>(null);
  // url: where STOP replies come back; marketing: the texts the server adds the STOP mention to (counted here too)
  const hook = useQuery<{ url: string | null; marketing?: string[] }>('/api/v1/messages/webhook');
  const marketing = new Set(hook.data?.marketing || ['rebook']);
  const M = m.v;
  const n0: Notify = { ...NOTIFY, ...(s.notify || {}) };
  const n = useSection<Notify>(n0);
  const N = n.v;
  // the bootstrap names the e-mail provider since WP-02; an older server simply has none
  const mailer = (boot.providers as { email?: string | null }).email || null;
  const badEmail = !!N.to && !EMAIL.test(N.to.trim());
  const badPhone = !!N.phone.trim() && !phoneOk(N.phone);
  // only what changed: the address and the number are saved apart, as personal data, and only when touched
  const notifyPatch = () => {
    const out: Partial<Notify> = {};
    const v: Notify = { ...N, to: N.to.trim(), phone: N.phone.trim() };
    for (const k of Object.keys(v) as (keyof Notify)[]) if (v[k] !== n0[k]) (out as Record<string, unknown>)[k] = v[k];
    return out;
  };
  const toggles: [string, string, string][] = [['confirmation', 'Confirmation de rendez-vous', 'Avec le lien pour déplacer ou annuler soi-même.'], ['reminder', 'Rappel la veille', 'Le meilleur remède contre les absences.'], ['reminder2h', 'Rappel 2 h avant', 'En plus, pour les oublis du jour même.'], ['review', 'Demande d’avis Google', 'Une fois par trimestre au plus par client.'], ['waitlist', 'Place libérée', 'Proposée au premier de la liste d’attente.'], ['rebook', 'Relances', 'Proposées dans Relances, jamais envoyées sans toi.']];
  const bad = TPL.find((t) => (M.templates[t.k] || '').trim().length < 10);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Envois automatiques" icon="bolt" aside={<span className={'badge ' + (boot.providers.sms ? 'badge-ok' : boot.mode === 'demo' ? 'badge-info' : 'badge-warn')}>{boot.providers.sms ? 'SMS via ' + cap(boot.providers.sms) : boot.mode === 'demo' ? 'Démo · simulé' : 'Aucun fournisseur'}</span>}>
        {toggles.map(([k, t, h]) => <Switch key={k} on={!!M[k]} onChange={(v) => m.setV({ ...M, [k]: v })} title={t} hint={h} />)}
        <div className="grid2">
          <Field label="Heure du rappel de la veille"><select className="input select" value={M.reminderHour} onChange={(e) => m.setV({ ...M, reminderHour: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{h} h</option>)}</select></Field>
          <Field label="Demande d’avis, après la visite"><select className="input select" value={M.reviewDelayMin} onChange={(e) => m.setV({ ...M, reviewDelayMin: Number(e.target.value) })}>{[30, 60, 120, 240, 1440].map((n) => <option key={n} value={n}>{n < 60 ? n + ' min' : n === 1440 ? 'le lendemain' : n / 60 + ' h'}</option>)}</select></Field>
        </div>
        <Note icon="moon">{quietWords(M.quiet)} Les avis, les relances et les places libérées attendent le matin.</Note>
        {!boot.providers.sms && boot.mode !== 'demo' ? <Note tone="warn" icon="alert">Branche Brevo ou Twilio (variables <code>SMS_PROVIDER</code>, <code>BREVO_API_KEY</code> ou <code>TWILIO_*</code>) pour que les SMS partent vraiment. En attendant, ils restent dans la boîte d’envoi.</Note> : null}
      </Card>
      <Card title="E-mails aux clients" icon="mail" aside={<span className={'badge ' + (mailer ? 'badge-ok' : boot.mode === 'demo' ? 'badge-info' : 'badge-warn')}>{mailer ? 'E-mail via ' + cap(mailer) : boot.mode === 'demo' ? 'Démo · simulé' : 'Aucun fournisseur'}</span>}>
        <Switch on={M.email !== false} onChange={(v) => m.setV({ ...M, email: v })} title="Confirmation et annulation par e-mail" hint="Aux clients qui ont donné leur e-mail, avec ou sans SMS : le rendez-vous à ajouter à l’agenda (fichier .ics) et le bouton « Gérer mon rendez-vous », puis le déplacement ou l’annulation." />
        {!mailer && boot.mode !== 'demo' ? <Note tone="warn" icon="alert">Ajoute <code>BREVO_API_KEY</code> et <code>EMAIL_FROM</code> (par exemple <code>rdv@barberlarchitecte.com</code>, une adresse validée dans Brevo) pour que les e-mails partent. En attendant, ils restent dans la boîte d’envoi.</Note> : null}
      </Card>
      <Card title="Me prévenir" icon="bell">
        <Field label="Mon e-mail" htmlFor="nt-to" error={badEmail ? 'Adresse e-mail invalide' : null} hint={N.to ? undefined : 'Vide : l’e-mail de ton compte' + (boot.me.email ? ' (' + boot.me.email + ')' : '') + '.'}>
          <input id="nt-to" className="input" type="email" inputMode="email" autoComplete="email" maxLength={120} placeholder={boot.me.email || 'toi@exemple.fr'} value={N.to} onChange={(e) => n.setV({ ...N, to: e.target.value })} />
        </Field>
        <Switch on={N.newBooking} onChange={(v) => n.setV({ ...N, newBooking: v })} title="Chaque réservation en ligne" hint="« Nouveau rendez-vous : Karim, jeu. 29/10 10 h avec JKut (Coupe classique) »." />
        <Switch on={N.cancel} onChange={(v) => n.setV({ ...N, cancel: v })} title="Chaque annulation en ligne" hint="Avec la raison donnée par le client." />
        <Switch on={!!N.evening} onChange={(v) => n.setV({ ...N, evening: v ? N.evening || NOTIFY.evening : '' })} title="Le résumé du soir" hint="Le chiffre du jour avec le Z et son sceau, les rendez-vous et les demi-heures libres de demain, les SMS et e-mails en échec, la dernière sauvegarde." />
        {N.evening ? (
          <div className="grid2">
            <Field label="Heure du résumé"><select className="input select" value={N.evening} onChange={(e) => n.setV({ ...N, evening: e.target.value })}>{EVENINGS.includes(N.evening) ? null : <option value={N.evening}>{N.evening}</option>}{EVENINGS.map((h) => <option key={h} value={h}>{time(toMin(h))}</option>)}</select></Field>
            <Field label="Aussi par SMS, au" htmlFor="nt-phone" error={badPhone ? 'Numéro invalide' : null} hint={badPhone ? undefined : 'Facultatif. Vide : par e-mail seulement.'}><input id="nt-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="06 12 34 56 78" value={N.phone} onChange={(e) => n.setV({ ...N, phone: e.target.value.replace(/[^\d +().-]/g, '') })} /></Field>
          </div>
        ) : null}
        <Switch on={N.weekly} onChange={(v) => n.setV({ ...N, weekly: v })} title="Le bilan de la semaine" hint="Le lundi à 8 h : chiffre d’affaires, visites, absences, meilleur barbier, prestations les plus demandées." />
      </Card>
      <Card title="Bons plans et STOP" icon="shield">
        <p className="muted" style={{ fontSize: 13.5 }}>Les relances ne partent qu’aux clients qui ont coché « Les bons plans du salon par SMS » sur le site (ou dont la fiche le dit), avec la mention « {(M.stopSuffix || '').trim()} » à la fin. Un client qui répond STOP est retiré tout seul. Aucun SMS ne part vers un numéro hors des indicatifs autorisés{Array.isArray(M.countries) && M.countries.length ? ' (' + M.countries.join(', ') + ')' : ''}.</p>
        {hook.data?.url ? <Field label="Adresse des désinscriptions (webhook Brevo)" hint="Envoyée avec chaque SMS. À renseigner aussi dans les webhooks SMS de Brevo, pour les réponses STOP."><input className="input" readOnly value={hook.data.url} onFocus={(e) => e.currentTarget.select()} /></Field>
          : hook.data && boot.mode !== 'demo' ? <Note tone="warn" icon="alert">Définis <code>CRON_SECRET</code> pour que les réponses STOP reviennent dans les fiches clients.</Note> : null}
      </Card>
      <Card title="Les textes" icon="edit">
        <p className="muted" style={{ fontSize: 13.5 }}>Les mots entre accolades sont remplacés pour chaque client. Un SMS fait 160 caractères ; un « ç », un « ê » ou un « ô » le fait passer à 70 (les apostrophes courbes sont corrigées automatiquement).</p>
        <ul className="list">
          {TPL.map((t) => {
            const txt = M.templates[t.k] || '';
            const plain = txt.replace(/\{(\w+)\}/g, (x: string, k: string) => SAMPLE[k] ?? x).replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-');
            const preview = marketing.has(t.k) ? withStop(plain, M.stopSuffix || '') : plain;
            const seg = smsSegments(preview);
            const isOpen = open === t.k;
            return (
              <li key={t.k} className="rg-tpl">
                <button type="button" className="li" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.k)}>
                  <span className="li-main"><b>{t.t}</b><small>{t.when} · {seg.chars} car. · {plural(seg.count, 'SMS')}{txt !== defaults[t.k] ? ' · personnalisé' : ''}</small></span>
                  <Icon name={isOpen ? 'chevD' : 'chevR'} size={16} />
                </button>
                {isOpen ? (
                  <div className="rg-tpl-ed">
                    <textarea className="input textarea" rows={3} maxLength={320} value={txt} onChange={(e) => m.setV({ ...M, templates: { ...M.templates, [t.k]: e.target.value } })} aria-label={'Texte : ' + t.t} />
                    <div className="chips">{t.vars.map((v) => <button key={v} type="button" className="chip chip-sm" onClick={() => m.setV({ ...M, templates: { ...M.templates, [t.k]: txt + (txt.endsWith(' ') ? '' : ' ') + '{' + v + '}' } })}>{'{' + v + '}'}</button>)}<span className="grow" />{txt !== defaults[t.k] ? <button type="button" className="link" onClick={() => m.setV({ ...M, templates: { ...M.templates, [t.k]: defaults[t.k] } })}>Texte d’origine</button> : null}</div>
                    <div className="bubble"><small>Aperçu</small><p>{preview}</p></div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <SaveBar dirty={m.dirty || n.dirty} busy={busy} disabled={!!bad || badEmail || badPhone} onReset={() => { m.reset(); n.reset(); }} onSave={() => save({ ...(m.dirty ? { messages: M } : {}), ...(n.dirty ? { notify: notifyPatch() } : {}) })} />
    </div>
  );
}
