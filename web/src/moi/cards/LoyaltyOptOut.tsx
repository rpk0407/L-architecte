// « Participer à la carte fidélité » (FID-03): the client's own right not to take part, in his Profil. Off, nothing more is
// counted on his card; the rewards he already earned stay good until they end. Nothing is drawn while the programme is off.
import { useState } from 'react';
import { setLoyaltyOff, useMeLoyalty } from '../loyalty';
import type { CardProps, MoiCardMeta } from '../types';
import '../avantages/loyalty.css';

export const meta: MoiCardMeta = { id: 'loyalty-off', tab: 'profile', order: 40 };

export default function LoyaltyOptOut(_: CardProps) {
  const { data: l, set, reload } = useMeLoyalty();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!l) return null;
  const on = !l.off;
  const flip = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await setLoyaltyOff(on);
      // the showcase's client changes nothing for the next visitor: the choice only stays on this screen
      if (r.demo) set({ off: on }); else await reload();
      setMsg(r.demo ? 'Dans la démo, ton choix n’est pas gardé.' : on ? 'Tu ne participes plus à la carte.' : 'Tu participes à la carte.');
    } catch (e) { setMsg((e as Error)?.message || 'Impossible de changer ton choix pour le moment.'); } finally { setBusy(false); }
  };
  return (
    <div className="c-card lyr-opt" data-guide="moi.loyalty-off">
      <button type="button" role="switch" aria-checked={on} className="lyr-sw" disabled={busy} onClick={flip}>
        <span><b>Participer à la carte fidélité</b><small>{on ? 'Tu cumules un tampon à chaque passage payé. Coupe ici si tu ne veux plus participer : tes récompenses déjà gagnées restent valables.' : 'Tes passages ne sont plus comptés. Tes récompenses déjà gagnées restent valables jusqu’à leur fin.'}</small></span>
        <span className="lyr-k2" aria-hidden><i /></span>
      </button>
      <p className="lyr-small" role="status" aria-live="polite">{msg}</p>
    </div>
  );
}
