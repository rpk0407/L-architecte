// Équipe et accès: what barbers may do, and the resulting matrix as the server computes it.
import { Icon } from '../../../../ui/Icon';
import { Chip, Field, Seg, Switch } from '../../../../ui/kit';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

const ROLE_ORDER: [string, string, string][] = [['owner', 'Gérant', 'Gér.'], ['manager', 'Responsable', 'Resp.'], ['desk', 'Accueil', 'Acc.'], ['barber', 'Barbier', 'Barb.']];
type View = 'off' | 'salon' | 'named';
const VIEWS: { v: View; t: string; hint: string }[] = [
  { v: 'off', t: 'Rien', hint: 'Chacun ne voit que ses propres chiffres.' },
  { v: 'salon', t: 'Le salon', hint: 'En plus, l’avancée du salon vers l’objectif du mois, en %, sans le chiffre des autres.' },
  { v: 'named', t: 'Toute l’équipe', hint: 'Le chiffre, le remplissage et la reprise de chaque barbier. Commissions et pourboires restent privés.' }
];
// the old « Voir le chiffre du salon » switch, still on in an old journal, reads as « Toute l’équipe » (server: teamViewOf)
const viewOf = (T: any): View => (T.barberSeeRevenue === true ? 'named' : T.teamView === 'off' || T.teamView === 'named' ? T.teamView : 'salon');

export default function Equipe({ s, data }: SectionProps) {
  const { roles, caps } = data;
  const t = useSection(s.team);
  const { busy, save } = useSave();
  const T = t.v;
  const view = viewOf(T);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Ce que les barbiers peuvent faire" icon="shield">
        <Switch on={T.barberCheckout} onChange={(v) => t.setV({ ...T, barberCheckout: v })} title="Encaisser" hint="Sinon, seuls l’accueil et le gérant encaissent." />
        <Switch on={T.barberAllAgenda} onChange={(v) => t.setV({ ...T, barberAllAgenda: v })} title="Voir l’agenda de tout le salon" hint="Utile pour prendre un client au vol quand un collègue est plein. Il y voit aussi les prestations et leurs prix." />
        <Switch on={T.timeoffApproval !== false} onChange={(v) => t.setV({ ...T, timeoffApproval: v })} title="Valider leurs absences" hint="Une absence posée par un barbier t’attend : ses créneaux restent ouverts jusqu’à ce que tu la valides, et tu replaces ses clients en un geste." />
        <Switch on={T.barberRebook === true} onChange={(v) => t.setV({ ...T, barberRebook: v })} title="Relancer leurs habitués" hint="Un barbier peut envoyer le SMS de relance du salon à ses propres clients qui ont accepté les offres." />
        <Switch on={T.personalPhones !== false} onChange={(v) => t.setV({ ...T, personalPhones: v })} title="Leur téléphone personnel" hint="Chacun peut lier son téléphone au Comptoir avec un QR code, et y entrer avec son code une fois par jour." />
        <Switch on={T.staffCalendar !== false} onChange={(v) => t.setV({ ...T, staffCalendar: v })} title="Leur agenda dans leur téléphone" hint="Prénom du client et prestation, jamais le numéro." />
        <Field label="Remise maximale qu’un barbier peut accorder"><div className="chips">{[0, 5, 10, 15, 20].map((n) => <Chip key={n} small on={T.barberMaxDiscountPct === n} onClick={() => t.setV({ ...T, barberMaxDiscountPct: n })}>{n ? n + ' %' : 'aucune'}</Chip>)}</div></Field>
      </Card>
      <Card title="Ce que chacun voit des autres" icon="eye">
        {/* choosing retires the old switch: the server would otherwise keep reading it as « Toute l’équipe » */}
        <Field label="Les chiffres des collègues" hint={<span aria-live="polite">{VIEWS.find((x) => x.v === view)!.hint}</span>}>
          <div className="rg-view"><Seg value={view} onChange={(v) => t.setV({ ...T, teamView: v, barberSeeRevenue: false })} options={VIEWS.map(({ v, t: l }) => ({ v, t: l }))} label="Ce que chacun voit des autres" /></div>
        </Field>
      </Card>
      <Card title="Qui peut quoi" icon="key" aside={<span className="faint" style={{ fontSize: 13 }}>Selon les réglages enregistrés</span>}>
        <div className="table-wrap">
          <table className="table rg-matrix">
            <thead><tr><th scope="col"><span className="vh">Droit</span></th>{ROLE_ORDER.map(([r, l, short]) => <th key={r} scope="col" title={l}><span className="rg-l">{l}</span><span className="rg-s" aria-hidden>{short}</span><span className="rg-s vh">{l}</span></th>)}</tr></thead>
            <tbody>{Object.entries(caps).map(([k, label]) => (
              <tr key={k}>
                <th scope="row">{label as string}</th>
                {ROLE_ORDER.map(([r]) => <td key={r}>{roles[r]?.includes(k) ? <Icon name="check" size={16} title="Oui" /> : <><span className="faint" aria-hidden>·</span><span className="vh">Non</span></>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Accueil : sur l’agenda, voit les compteurs du salon (rendez-vous, remplissage), jamais le chiffre d’affaires.</p>
        <p className="faint" style={{ fontSize: 12.5 }}>Chaque droit est vérifié par le serveur à chaque action : masquer un bouton n’est jamais la seule protection.</p>
      </Card>
      {/* what is stored is the view on screen: an old journal's switch, echoed back with the default teamView, would
          otherwise turn « Toute l’équipe » into « Le salon » on an unrelated save */}
      <SaveBar dirty={t.dirty} busy={busy} onReset={t.reset} onSave={() => save({ team: { ...T, teamView: view, barberSeeRevenue: false } })} />
    </div>
  );
}
