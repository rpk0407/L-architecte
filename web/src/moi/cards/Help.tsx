// GUIDE-01a · /moi › Profil › Aide: the space's guided tour again (« Comment ça marche ? »), just above the exit card
// (Session, order 99). Its own card, found by the folder registry (web/src/moi/registry.ts).
import type { MoiCardMeta } from '../types';
import { Section } from '../profile/kit';
import { startMoiTour } from '../guide/MoiTour';
import './profile.css';

export const meta = { id: 'help', tab: 'profile', order: 98 } satisfies MoiCardMeta;

export default function Help() {
  return (
    <Section k="Aide" guide="profile-help">
      <div className="mp-links">
        <button type="button" className="c-link mp-link" onClick={startMoiTour}>Comment ça marche ?</button>
        <small className="c-muted">Ton espace, partie par partie, en une minute.</small>
      </div>
    </Section>
  );
}
