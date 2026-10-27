// Le salon: contact details, the ticket's legal lines and the links sent to clients.
import { Field, Note } from '../../../../ui/kit';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

export default function Salon({ s }: SectionProps) {
  const shop = useSection(s.shop);
  const foot = useSection(s.payments.receiptFooter as string);
  const { busy, save } = useSave();
  const f = shop.v;
  const set = (k: string, v: string) => shop.setV({ ...f, [k]: v });
  const input = (k: string, label: string, o: { hint?: string; type?: string; ph?: string } = {}) => <Field label={label} hint={o.hint} htmlFor={'sh-' + k}><input id={'sh-' + k} className="input" type={o.type || 'text'} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} placeholder={o.ph} /></Field>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Coordonnées" icon="map">
        <div className="grid2">{input('name', 'Nom du salon')}{input('phone', 'Téléphone', { type: 'tel', ph: '04 91 …' })}</div>
        {input('address', 'Adresse')}
        <div className="grid2">{input('zip', 'Code postal')}{input('city', 'Ville')}</div>
        {input('email', 'E-mail de contact', { type: 'email' })}
      </Card>
      <Card title="Mentions légales du ticket" icon="ticket">
        <div className="grid2">{input('legalName', 'Raison sociale', { ph: 'L’Architecte SAS' })}{input('siret', 'SIRET', { ph: '123 456 789 00012' })}</div>
        {input('vatNumber', 'N° de TVA intracommunautaire', { ph: 'FR…' })}
        <Field label="Message en bas du ticket" htmlFor="sh-foot"><input id="sh-foot" className="input" maxLength={160} value={foot.v} onChange={(e) => foot.setV(e.target.value)} /></Field>
        {!f.siret ? <Note tone="warn" icon="alert">Le SIRET doit figurer sur les tickets remis aux clients.</Note> : null}
      </Card>
      <Card title="Liens" icon="link">
        {input('reviewUrl', 'Lien d’avis Google', { hint: 'Envoyé après la visite quand la demande d’avis est active.', type: 'url' })}
        {input('mapsUrl', 'Lien Google Maps', { type: 'url' })}
        {input('instagram', 'Instagram du salon', { type: 'url' })}
      </Card>
      <SaveBar dirty={shop.dirty || foot.dirty} busy={busy} disabled={!f.name || f.name.length < 2} onReset={() => { shop.reset(); foot.reset(); }} onSave={() => save({ ...(shop.dirty ? { shop: f } : {}), ...(foot.dirty ? { payments: { receiptFooter: foot.v } } : {}) })} />
    </div>
  );
}
