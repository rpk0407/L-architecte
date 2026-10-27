// The client space's small kit, on top of the client pages' look (client.css): the site's booking sheet as a dialog
// (bottom sheet on a phone, a panel on the right on a computer, as on the site), the row of « Mes avantages », and the
// sign-out every card may need. Rows and cards of other areas may use these; nothing here knows about them.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { dates } from '../lib/format';
import { Icon } from '../ui/Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that keeps the focus inside while open and gives it back to what opened it: Escape, the veil and the close
 * button close it. kicker: the small line above the title (« Mes avantages »).
 */
export function Sheet({ title, kicker, onClose, children, guide }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; guide?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    head.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const list = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const inside = box.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside || document.activeElement === head.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      if (back && back.isConnected) back.focus();
    };
  }, []);
  return createPortal(
    <>
      <div className="m-veil" onClick={() => close.current()} aria-hidden="true" />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={box} data-guide={guide}>
        <div className="m-sheet-top">
          <div className="m-sheet-tt">{kicker ? <p className="c-k">{kicker}</p> : null}<h2 className="m-sheet-t" id={id} tabIndex={-1} ref={head}>{title}</h2></div>
          <button type="button" className="m-x" aria-label="Fermer" onClick={() => close.current()}><Icon name="x" size={20} /></button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </>,
    document.body
  );
}

/** One row of « Mes avantages »: what it is and the figure that matters, opening its detail. */
export function AvRow({ icon, title, sub, onOpen, guide }: { icon: string; title: string; sub: string; onOpen: () => void; guide?: string }) {
  return (
    <button type="button" className="m-av" onClick={onOpen} data-guide={guide}>
      <span className="m-av-i" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="m-av-t"><b>{title}</b><small>{sub}</small></span>
      <Icon name="chevR" size={18} className="m-av-go" />
    </button>
  );
}

/** Today in Paris (the salon's days), whatever this phone's time zone. */
export const todayKey = () => dates.localParts(Date.now()).day;

/** « jusqu’au 14 déc. », « jusqu’au 1er mars 2027 »: the year only when it is not this one. */
export function until(day: string, today = todayKey()) {
  const p = dates.dayParts(day);
  return 'jusqu’au ' + (p.d === 1 ? '1er' : p.d) + ' ' + dates.MONTHS_SH[p.m - 1] + (day.slice(0, 4) !== today.slice(0, 4) ? ' ' + p.y : '');
}

/** Signs this phone out; the page then shows the sign-in again. */
export async function signOut() {
  await api.post('/api/me/signout', {}).catch(() => {});
  location.assign('/moi');
}
