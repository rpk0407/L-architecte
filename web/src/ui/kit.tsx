// The Comptoir's components. Accessible by default: real buttons, labelled dialogs, focus that returns.
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { eur } from '../lib/format';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'solid' | 'ghost' | 'subtle' | 'danger' | 'ok'; size?: 'sm' | 'md' | 'lg' | 'xl'; icon?: string; block?: boolean; busy?: boolean; kbd?: string };
export function Button({ variant = 'subtle', size = 'md', icon, block, busy, kbd, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', 'btn-' + variant, size !== 'md' ? 'btn-' + size : '', block ? 'btn-block' : '', !children ? 'btn-icon' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      {children}
      {kbd ? <span className="kbd">{kbd}</span> : null}
    </button>
  );
}

export function Money({ cents, decimals, className = '' }: { cents: number | null | undefined; decimals?: boolean; className?: string }) {
  return <span className={'money tnum ' + className}>{eur(cents, { decimals })}</span>;
}

export function Avatar({ name, initials, color, size = '' }: { name?: string; initials?: string; color?: string; size?: '' | 'sm' | 'lg' | 'xl' }) {
  const ini = initials || (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <span className={'av' + (size ? ' av-' + size : '')} style={{ ['--c' as any]: color || undefined } as CSSProperties} aria-hidden>{ini}</span>;
}

export function Chip({ on, onClick, children, dot, small, className = '', disabled, title }: { on?: boolean; onClick?: () => void; children: ReactNode; dot?: string; small?: boolean; className?: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={'chip' + (small ? ' chip-sm' : '') + (className ? ' ' + className : '')} aria-pressed={on ? 'true' : 'false'} onClick={onClick} disabled={disabled} title={title}>
      {dot ? <span className="dot" style={{ background: dot }} /> : null}
      {children}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: ReactNode; count?: number }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.v} type="button" aria-pressed={o.v === value} onClick={() => onChange(o.v)}>{o.t}{o.count ? <span className="count">{o.count}</span> : null}</button>)}
    </div>
  );
}

export function Switch({ on, onChange, title, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; title: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)} disabled={disabled}>
      <span className="switch-t"><b>{title}</b>{hint ? <small>{hint}</small> : null}</span>
      <span className="switch-k" aria-hidden><i /></span>
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <span className="hint err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Kpi({ k, v, s, bar, hot, dots, delta, onClick, icon }: { k: ReactNode; v: ReactNode; s?: ReactNode; bar?: number; hot?: boolean; dots?: number; delta?: number | null; onClick?: () => void; icon?: string }) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag className={'kpi' + (hot ? ' hot' : '')} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="kpi-k">{icon ? <Icon name={icon} size={15} /> : null}{k}{delta != null && Number.isFinite(delta) ? <Delta v={delta} /> : null}</span>
      <span className="kpi-v">{v}</span>
      {s ? <span className="kpi-s">{s}</span> : null}
      {bar != null ? <span className="kpi-bar" aria-hidden><i style={{ ['--w' as any]: Math.round(Math.min(1, Math.max(0, bar)) * 100) + '%' }} /></span> : null}
      {dots != null ? <span className="dots" aria-hidden style={{ ['--f' as any]: Math.round(Math.min(1, dots) * 100) + '%' }} /> : null}
    </Tag>
  );
}
export function Delta({ v }: { v: number }) {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return <span className="delta" style={{ color: 'var(--tx3)' }}>=</span>;
  return <span className={'delta ' + (v > 0 ? 'up' : 'down')}>{v > 0 ? '↑' : '↓'} {Math.abs(Math.round(v * 100))} %</span>;
}

export function Empty({ icon = 'info', title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="ic"><Icon name={icon} /></span><b>{title}</b>{children ? <p>{children}</p> : null}{action}</div>;
}
export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="sk" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}
export function Note({ tone = '', icon = 'info', children }: { tone?: '' | 'warn' | 'err' | 'ok' | 'accent'; icon?: string; children: ReactNode }) {
  return <div className={'note ' + tone}><Icon name={icon} /><div>{children}</div></div>;
}

/* ---------------- overlays ---------------- */

function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    const el = ref.current;
    const t = setTimeout(() => {
      const first = el?.querySelector<HTMLElement>('[data-autofocus]') || el?.querySelector<HTMLElement>('input, textarea, select') || el;
      first?.focus({ preventScroll: true });
    }, 40);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', key);
      html.style.overflow = prev;
      (back.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open]);
  return ref;
}

export function Sheet({ open, onClose, title, kicker, children, footer, wide, labelledBy }: { open: boolean; onClose: () => void; title?: ReactNode; kicker?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="veil" onClick={onClose} aria-hidden />
      <div ref={ref} className={'sheet sheet-side' + (wide ? ' sheet-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={labelledBy || 'sheet-t'} tabIndex={-1}>
        {title != null ? (
          <div className="sheet-h">
            <div className="grow">{kicker ? <p className="k">{kicker}</p> : null}<h2 id="sheet-t">{title}</h2></div>
            <Button icon="x" aria-label="Fermer" onClick={onClose} />
          </div>
        ) : null}
        <div className="sheet-b">{children}</div>
        {footer ? <div className="sheet-f">{footer}</div> : null}
      </div>
    </>,
    document.body
  );
}

export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="veil" onClick={onClose} aria-hidden />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div>
    </>,
    document.body
  );
}

/** Menu anchored to the element that opened it. */
export function Menu({ anchor, onClose, children }: { anchor: DOMRect | { x: number; y: number } | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const el = ref.current;
    const w = el ? el.offsetWidth : 240, h = el ? el.offsetHeight : 200;
    const ax = 'left' in anchor ? anchor.left : anchor.x, ay = 'bottom' in anchor ? anchor.bottom + 6 : anchor.y;
    setPos({ left: Math.max(8, Math.min(innerWidth - w - 8, ax)), top: ay + h > innerHeight - 8 ? Math.max(8, ay - h - ('height' in anchor ? anchor.height + 12 : 12)) : ay });
    const out = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('pointerdown', out), 0);
    document.addEventListener('keydown', key);
    setTimeout(() => el?.querySelector<HTMLElement>('button, a')?.focus(), 30);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', key); };
  }, [anchor]);
  if (!anchor) return null;
  return createPortal(<div ref={ref} className="pop" role="menu" style={pos ? pos : { left: -9999, top: -9999 }} onClick={(e) => { if ((e.target as HTMLElement).closest('button, a')) onClose(); }}>{children}</div>, document.body);
}

/* ---------------- toasts ---------------- */

// actions: a choice to make right there (Refuser / Valider), after or instead of the one `action`
type Toast = { id: number; title: ReactNode; sub?: ReactNode; kind?: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void }; actions?: { label: string; run: () => void }[]; icon?: string; ttl?: number };
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
let tid = 0;
export function toast(t: Omit<Toast, 'id'> | string) {
  const item: Toast = typeof t === 'string' ? { id: ++tid, title: t } : { id: ++tid, ...t };
  toasts = [...toasts.slice(-2), item];
  tsubs.forEach((f) => f());
  setTimeout(() => dismiss(item.id), item.ttl || (item.action || item.actions ? 7000 : item.kind === 'err' ? 6000 : 3800));
  return item.id;
}
export function dismiss(id: number) { toasts = toasts.filter((x) => x.id !== id); tsubs.forEach((f) => f()); }
export const toastError = (e: any) => toast({ kind: 'err', title: e?.message || 'Une erreur est survenue.', icon: 'alert' });

export function Toasts() {
  const list = useSyncExternalStore((f) => { tsubs.add(f); return () => tsubs.delete(f); }, () => toasts);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : t.kind === 'info' ? ' info' : '')}>
          {t.icon ? <span className="ic"><Icon name={t.icon} /></span> : null}
          <span className="t">{t.title}{t.sub ? <small>{t.sub}</small> : null}</span>
          {t.action ? <button type="button" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button> : null}
          {(t.actions || []).map((a) => <button key={a.label} type="button" onClick={() => { a.run(); dismiss(t.id); }}>{a.label}</button>)}
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ---------------- confirm ---------------- */

type Ask = { title: ReactNode; body?: ReactNode; ok?: string; cancel?: string; danger?: boolean; resolve: (v: boolean) => void };
let asking: Ask | null = null;
const asubs = new Set<() => void>();
export function confirm(o: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => { asking = { ...o, resolve }; asubs.forEach((f) => f()); });
}
export function ConfirmHost() {
  const a = useSyncExternalStore((f) => { asubs.add(f); return () => asubs.delete(f); }, () => asking);
  const close = (v: boolean) => { a?.resolve(v); asking = null; asubs.forEach((f) => f()); };
  return (
    <Modal open={!!a} onClose={() => close(false)} label="Confirmation">
      {a ? (
        <>
          <h2>{a.title}</h2>
          {a.body ? <p>{a.body}</p> : null}
          <div className="acts">
            <Button variant="ghost" onClick={() => close(false)}>{a.cancel || 'Annuler'}</Button>
            <Button variant={a.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>{a.ok || 'Confirmer'}</Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
