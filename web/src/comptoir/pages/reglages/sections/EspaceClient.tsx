// AC-02 · Réglages › Réservation: the switch of the client space (/moi: his bookings and receipts behind a code by SMS) and
// the figure that says whether anyone uses it. The setting itself is AC-01's (settings.accounts.enabled); this card saves it
// at once, like a light switch: nothing to forget in the save bar.
import { useQuery } from '../../../../lib/query';
import { Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, useSave } from '../shared';

type Stats = { accounts: number; active30: number; opened30: number };

export default function EspaceClient({ s }: { s: any }) {
  const { boot } = useApp();
  const { busy, save } = useSave();
  const on = !!s.accounts?.enabled;
  // owner and manager read the figures; for anyone else the route says no and the line is simply not there
  const { data } = useQuery<Stats>('/api/v1/accounts/stats');
  // a code that cannot leave opens nothing: production waits for the SMS route (plan, decision 3)
  const noSms = boot.mode !== 'demo' && !boot.providers.sms;
  return (
    <div data-guide="espace-client">
      <Card title="Espace client" icon="user">
        <Switch on={on} disabled={busy} onChange={(v) => save({ accounts: { enabled: v } }, v ? 'Espace client ouvert' : 'Espace client fermé')} title="Espace client sur le site"
          hint="Tes clients retrouvent leurs rendez-vous et leurs reçus avec un code SMS. Un compte se crée en un geste après la première réservation, ou depuis la fiche au salon. Sans mot de passe." />
        {on && noSms ? <Note tone="warn" icon="alert">Aucun SMS ne peut partir pour l’instant : les clients ne recevraient pas leur code. Branche le SMS avant d’en parler à tes clients.</Note> : null}
        {data ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {data.accounts ? <><b>{data.accounts} {data.accounts > 1 ? 'clients ont un espace' : 'client a un espace'}</b>{data.active30 ? ' · ' + data.active30 + (data.active30 > 1 ? ' y sont revenus' : ' y est revenu') + ' ce dernier mois' : ''}</> : 'Aucun client n’a encore ouvert son espace.'}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
