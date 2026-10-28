// « Profil » › this phone's session: sign out here, the space stays open on the client's other devices. The rest of the
// profile (barber, details, messages, data, every device) is AC-02's Profile card, in the same folder.
// MERGE NOTE: AC-02's Profile card has its own « Se déconnecter » row. When it lands, delete this file, the guide step
// moi.session (guide/steps/AC-03a.ts) and this card's entry in tests/unit/moi-registry.test.js, so one button remains.
import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { signOut } from '../kit';

export const meta = { id: 'session', tab: 'profile' as const, order: 100 };

export default function Session() {
  const [busy, setBusy] = useState(false);
  return (
    <section className="c-card m-session" aria-labelledby="m-session-t" data-guide="moi.session">
      <h2 className="c-k" id="m-session-t">Ce téléphone</h2>
      <button type="button" className="m-line" disabled={busy} onClick={() => { setBusy(true); signOut(); }}>
        <Icon name="logout" size={20} /><span><b>Se déconnecter</b><small>Ton espace reste ouvert sur tes autres appareils. Pour revenir ici, un code par SMS suffit.</small></span>
      </button>
    </section>
  );
}
