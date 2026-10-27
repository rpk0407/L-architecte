// Équipe et accès: what barbers may do, and the resulting matrix as the server computes it.
import { Icon } from '../../../../ui/Icon';
import { Chip, Field, Switch } from '../../../../ui/kit';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

const ROLE_ORDER: [string, string][] = [['owner', 'Gérant'], ['manager', 'Responsable'], ['desk', 'Accueil'], ['barber', 'Barbier']];
export default function Equipe({ s, data }: SectionProps) {
  const { roles, caps } = data;
  const t = useSection(s.team);
  const { busy, save } = useSave();
  const T = t.v;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Ce que les barbiers peuvent faire" icon="shield">
        <Switch on={T.barberCheckout} onChange={(v) => t.setV({ ...T, barberCheckout: v })} title="Encaisser" hint="Sinon, seuls l’accueil et le gérant encaissent." />
        <Switch on={T.barberAllAgenda} onChange={(v) => t.setV({ ...T, barberAllAgenda: v })} title="Voir l’agenda de tout le salon" hint="Utile pour prendre un client au vol quand un collègue est plein." />
        <Switch on={T.barberSeeRevenue} onChange={(v) => t.setV({ ...T, barberSeeRevenue: v })} title="Voir le chiffre du salon" hint="Sinon chacun ne voit que ses propres chiffres et sa commission." />
        <Field label="Remise maximale qu’un barbier peut accorder"><div className="chips">{[0, 5, 10, 15, 20].map((n) => <Chip key={n} small on={T.barberMaxDiscountPct === n} onClick={() => t.setV({ ...T, barberMaxDiscountPct: n })}>{n ? n + ' %' : 'aucune'}</Chip>)}</div></Field>
      </Card>
      <Card title="Qui peut quoi" icon="key" aside={<span className="faint" style={{ fontSize: 13 }}>Selon les réglages enregistrés</span>}>
        <div className="table-wrap">
          <table className="table rg-matrix">
            <thead><tr><th />{ROLE_ORDER.map(([r, l]) => <th key={r} className="num">{l}</th>)}</tr></thead>
            <tbody>{Object.entries(caps).map(([k, label]) => <tr key={k}><td>{label}</td>{ROLE_ORDER.map(([r]) => <td key={r} className="num">{roles[r]?.includes(k) ? <Icon name="check" size={16} /> : <span className="faint">·</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Chaque droit est vérifié par le serveur à chaque action : masquer un bouton n’est jamais la seule protection.</p>
      </Card>
      <SaveBar dirty={t.dirty} busy={busy} onReset={t.reset} onSave={() => save({ team: T })} />
    </div>
  );
}
