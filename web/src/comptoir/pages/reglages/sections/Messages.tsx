// Messages: which SMS go out on their own, when, and the owner's version of each text with a live preview.
import { useState } from 'react';
import { cap, plural } from '../../../../lib/format';
import { Icon } from '../../../../ui/Icon';
import { Field, Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { smsSegments } from '../../Relances';
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
const SAMPLE: Record<string, string> = { prenom: 'Karim', date: 'jeudi 12 novembre', heure: '14 h 30', barbier: 'JKut', prestation: 'Coupe + taille de barbe', lien: 'https://larchitecte.fr/r/LA-7K2P', avis: 'https://g.page/r/…', jours: '34', ticket: 'T001042', montant: '30,00 €' };

export default function Messages({ s, data }: SectionProps) {
  const { boot } = useApp();
  const defaults = data.defaultTemplates;
  const m = useSection(s.messages);
  const { busy, save } = useSave();
  const [open, setOpen] = useState<string | null>(null);
  const M = m.v;
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
        {!boot.providers.sms && boot.mode !== 'demo' ? <Note tone="warn" icon="alert">Branche Brevo ou Twilio (variables <code>SMS_PROVIDER</code>, <code>BREVO_API_KEY</code> ou <code>TWILIO_*</code>) pour que les SMS partent vraiment. En attendant, ils restent dans la boîte d’envoi.</Note> : null}
      </Card>
      <Card title="Les textes" icon="edit">
        <p className="muted" style={{ fontSize: 13.5 }}>Les mots entre accolades sont remplacés pour chaque client. Un SMS fait 160 caractères ; un « ç », un « ê » ou un « ô » le fait passer à 70 (les apostrophes courbes sont corrigées automatiquement).</p>
        <ul className="list">
          {TPL.map((t) => {
            const txt = M.templates[t.k] || '';
            const preview = txt.replace(/\{(\w+)\}/g, (x: string, k: string) => SAMPLE[k] ?? x).replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-');
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
      <SaveBar dirty={m.dirty} busy={busy} disabled={!!bad} onReset={m.reset} onSave={() => save({ messages: M })} />
    </div>
  );
}
