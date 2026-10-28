// « Ma carte fidélité » (FID-03): one row of « Mes avantages » (the card and its count), opening a sheet with the full card,
// the rewards that wait, « Parrainer un ami » and the règlement. Nothing is drawn while the programme is off.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyText } from '../../lib/clipboard';
import { dayWords } from '../../lib/loyalty';
import { Icon } from '../../ui/Icon';
import { StampCard } from '../../ui/StampCard';
import { useMeLoyalty } from '../loyalty';
import type { AvantageMeta, CardProps } from '../types';
import './loyalty.css';

export const meta: AvantageMeta = { id: 'loyalty', order: 30 };

/** A sheet that holds focus, closes on Escape and gives focus back where it came from. */
function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === el)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); html.style.overflow = prev; back?.focus?.({ preventScroll: true }); };
  }, []);
  return createPortal(
    <>
      <div className="lyr-veil" onClick={onClose} aria-hidden />
      <div ref={ref} className="lyr-sheet" role="dialog" aria-modal="true" aria-labelledby="lyr-title" tabIndex={-1}>
        <div><p className="lyr-k">Fidélité</p><h2 className="lyr-h" id="lyr-title">{title}</h2></div>
        {children}
        <button type="button" className="lyr-close" onClick={onClose}>Fermer</button>
      </div>
    </>,
    document.body
  );
}

export default function Loyalty({ me }: CardProps) {
  const { data: l } = useMeLoyalty();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  // neither the share sheet nor the clipboard worked: the link itself, to copy by hand
  const [manual, setManual] = useState(false);
  if (!l) return null;
  const { units, goal } = l.card;

  // « Parrainer un ami »: the phone's own share sheet, else the link copied
  const share = async () => {
    if (!l.referral) return;
    const text = 'Je te conseille ' + (me.shop.name || 'L’Architecte') + ' : avec mon lien, ' + l.referral.offer + '.';
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ text, url: l.referral.link }); return; }
      await copyText(l.referral.link);
      setSaid('Lien copié');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      try { await copyText(l.referral.link); setSaid('Lien copié'); } catch { setManual(true); }
    }
  };
  const waiting = l.rewards[0];

  return (
    <div data-guide="moi.loyalty">
      <button type="button" className="lyr" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="lyr-t"><span className="lyr-tt"><b>Ma carte fidélité</b>{waiting ? <em className="lyr-chip">Récompense</em> : null}</span><StampCard units={units} goal={goal} size="sm" /></span>
        {l.off ? <span className="lyr-n s">Ne participe pas</span> : <span className="lyr-n">{units + '/' + goal}</span>}
        <Icon name="chevR" size={18} />
      </button>
      {open ? (
        <Sheet onClose={() => { setOpen(false); setSaid(''); setManual(false); }} title="Ma carte fidélité">
          <StampCard units={units} goal={goal} />
          <p className="lyr-head">{l.headline}</p>
          {l.off ? <p className="lyr-small">Tu peux changer ça à tout moment dans ton Profil.</p> : <p className="lyr-small">{l.rule}</p>}
          {l.rewards.map((r) => <div key={r.id} className="lyr-rw"><b>{r.label}</b><span>À utiliser avant le {dayWords(r.expires)}</span></div>)}
          {waiting ? <a className="lyr-btn" href="/?reserver">Réserver</a> : null}
          {l.referral ? (
            <div className="lyr-ref" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="lyr-btn ghost" onClick={share}><Icon name="heart" size={20} />Parrainer un ami</button>
              <p className="lyr-small" role="status">{manual ? <>Copie ce lien : <span className="lyr-link">{l.referral.link}</span></> : said || (l.referral.count ? l.referral.count + (l.referral.count > 1 ? ' amis venus grâce à toi' : ' ami venu grâce à toi') : 'Ton ami reçoit ' + l.referral.gift + ' sur sa première visite.')}</p>
            </div>
          ) : null}
          <details className="lyr-terms"><summary>Règlement</summary><div>{l.terms.map((t, i) => <p key={i}>{t}</p>)}</div></details>
        </Sheet>
      ) : null}
    </div>
  );
}
