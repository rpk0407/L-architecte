// A barber's own phone (TEAM-02): the QR that links it (10 minutes, once), and the phones already linked, removable by
// him or the owner. Shown in Mon compte (one's own) and in Équipe › Accès (a member's, for the owner).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { dates } from '../../../lib/format';
import { useInterval } from '../../../lib/hooks';
import { QR } from '../../../lib/qr';
import { Icon } from '../../../ui/Icon';
import { Button, Note, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Staff } from '../../types';

export type Phone = { id: string; name: string; at: number; current: boolean };
export const usePhones = (staffId: string) => useQuery<{ items: Phone[] }>('/api/v1/staff/' + encodeURIComponent(staffId) + '/phones');

/** the server's 10 minutes, read on a clock that may be a few hundred ms off: never more than 10:00 */
const mmss = (ms: number) => { const s = Math.min(600, Math.max(0, Math.ceil(ms / 1000))); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/**
 * The QR the phone scans. Asked for on a tap (each one is a journal line), valid 10 minutes on the server's clock; it
 * goes as soon as a new phone shows up in the list (the pulse refreshes it).
 */
export function PhoneQR({ st, self, compact }: { st: Pick<Staff, 'id' | 'name' | 'hasPin'>; self: boolean; compact?: boolean }) {
  const { now } = useApp();
  const phones = usePhones(st.id);
  const [link, setLink] = useState<{ url: string; exp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const ask = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ url: string; exp: number }>('/api/v1/staff/' + encodeURIComponent(st.id) + '/phone-link');
      known.current = new Set((phones.data?.items || []).map((p) => p.id));
      setLink(r); setLeft(r.exp - now());
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  useInterval(() => setLeft(link ? link.exp - now() : 0), link ? 1000 : null);
  // the phone linked itself: the QR has done its job
  useEffect(() => {
    if (!link || !known.current || !phones.data) return;
    const fresh = phones.data.items.find((p) => !known.current!.has(p.id));
    if (fresh) { setLink(null); known.current = null; toast({ title: 'Téléphone lié', sub: fresh.name, icon: 'check' }); }
  }, [phones.data]);
  if (!st.hasPin) return <Note icon="key">{self ? 'Choisis d’abord ton code (ci-dessous) : c’est lui qui ouvrira ton téléphone.' : st.name + ' n’a pas encore de code : définis-le d’abord.'}</Note>;
  if (!link) return <div><Button variant={compact ? 'ghost' : 'primary'} size={compact ? 'sm' : 'md'} icon="qr" busy={busy} onClick={ask}>{self ? 'Lier mon téléphone' : 'Lier son téléphone'}</Button></div>;
  const expired = left <= 0;
  return (
    <div className="row wrap" style={{ gap: 18, alignItems: 'center' }}>
      {expired ? (
        <div className="col" style={{ gap: 10, alignItems: 'center' }}>
          <p className="muted" role="status">Ce QR code a expiré.</p>
          <Button variant="primary" icon="qr" busy={busy} onClick={ask}>Nouveau QR code</Button>
        </div>
      ) : (
        <>
          <QR text={link.url} size={196} label={'QR code pour lier le téléphone de ' + st.name} />
          <div className="col" style={{ gap: 6 }}>
            <b>Scanne avec ton téléphone</b>
            <p className="muted" style={{ fontSize: 13.5 }}>L’appareil photo ouvre le Comptoir : {self ? 'tape' : st.name + ' tape'} « Lier mon téléphone », puis {self ? 'ton' : 'son'} code. Une seule fois, valable 10 minutes.</p>
            <p className="row tnum muted" style={{ gap: 6, fontSize: 13.5 }} role="timer" aria-live="off" aria-label={'Expire dans ' + mmss(left)}><Icon name="clock" size={14} />Expire dans {mmss(left)}</p>
            <div><Button size="sm" variant="ghost" onClick={() => setLink(null)}>Fermer</Button></div>
          </div>
        </>
      )}
    </div>
  );
}

/** The phones linked to this person, each removable: its session ends at its next request. */
export function PhoneList({ st, self }: { st: Pick<Staff, 'id' | 'name'>; self: boolean }) {
  const { signOut } = useApp();
  const { data } = usePhones(st.id);
  const items = data?.items || [];
  const remove = async (p: Phone) => {
    const body = p.current ? 'Tu seras déconnecté de ce téléphone tout de suite.' : 'Il faudra le lier à nouveau avec un QR code.';
    if (!await confirm({ title: 'Retirer « ' + p.name + ' » ?', body, ok: 'Retirer', danger: true })) return;
    try { await api.del('/api/v1/staff/' + encodeURIComponent(st.id) + '/phones/' + encodeURIComponent(p.id)); }
    catch (e) { toastError(e); return; }
    if (p.current) { await signOut(); return; }
    toast({ title: 'Téléphone retiré', sub: p.name, icon: 'check' });
    refreshAll();
  };
  if (!items.length) return <p className="faint" style={{ fontSize: 13 }}>{self ? 'Aucun téléphone lié pour l’instant.' : 'Aucun téléphone lié.'}</p>;
  return (
    <ul className="list" aria-label={self ? 'Mes téléphones' : 'Téléphones de ' + st.name}>
      {items.map((p) => (
        <li key={p.id} className="li">
          <Icon name="device" size={20} />
          <span className="li-main"><b>{p.name}</b><small>{p.current ? 'Ce téléphone · ' : ''}lié le {dates.dayShort(dates.localParts(p.at).day)}</small></span>
          <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label={'Retirer ' + p.name}>Retirer</Button>
        </li>
      ))}
    </ul>
  );
}
