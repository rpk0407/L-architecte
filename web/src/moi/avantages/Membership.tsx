// PAY-04 · The membership's row in /moi « Mes avantages » (AC-03a reads this folder): « Abonnement Essentiel · 1/2
// coupes ce mois », which opens the member page itself (the same view as /abo/:token) on the session's own routes
// (/api/me/membership*). Nothing shows without a membership.
import { useEffect, useRef, useState } from 'react';
import type { AvantageMeta, CardProps } from '../types';
// the sheet is the member page itself: /moi loads client.css (its kit and its dark theme), member.css (through Member) adds the rest
import { MemberPanel, meSource, counterWords, statusWords, type MemberPage } from '../../client/abonnement/Member';

export const meta: AvantageMeta = { id: 'membership', order: 10 };

export default function Membership({ reload }: CardProps) {
  const [page, setPage] = useState<MemberPage | null>(null);
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const load = () => meSource.load().then(setPage).catch(() => setPage(null));
  useEffect(() => { load(); }, []);
  // the sheet keeps the focus while open (Tab cycles inside, Escape closes) and gives it back to the row
  useEffect(() => {
    if (!open) return;
    const el = sheet.current;
    const first = el ? el.querySelector<HTMLElement>('h2') : null;
    if (first) first.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],select,input')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); row.current?.focus(); };
  }, [open]);
  const m = page && page.member;
  if (!m) return null;
  return (
    <>
      <button type="button" ref={row} className="mb-row" data-guide="moi-membership" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span><b>Abonnement {m.plan.name} · {counterWords(m)}</b><small>{statusWords(m).text}</small></span>
      </button>
      {open ? (
        <>
          <div className="mb-veil" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="mb-sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="mb-sheet-t">
            <div className="mb-sheet-top">
              <h2 className="c-k" id="mb-sheet-t" tabIndex={-1}>Mon abonnement</h2>
              <button type="button" className="mb-x" aria-label="Fermer" onClick={() => setOpen(false)}>×</button>
            </div>
            <MemberPanel source={meSource} onChange={() => { load(); reload(); }} />
          </div>
        </>
      ) : null}
    </>
  );
}
