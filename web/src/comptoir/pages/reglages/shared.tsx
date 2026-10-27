// What every salon settings section shares: the settings as loaded, a local copy with dirty tracking, one save, the card.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { refreshAll } from '../../../lib/query';
import { Icon } from '../../../ui/Icon';
import { Button, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';

export type SettingsData = { settings: any; defaultTemplates: Record<string, string>; roles: Record<string, string[]>; caps: Record<string, string> };
/** What Shop hands each section: the saved settings (s) and the rest of GET /api/v1/settings. */
export type SectionProps = { s: any; data: SettingsData };

/** A local copy of one settings section, with dirty tracking and one save. */
export function useSection<T>(src: T) {
  const [v, setV] = useState<T>(src);
  const key = JSON.stringify(src);
  useEffect(() => { setV(src); }, [key]);
  return { v, setV, dirty: JSON.stringify(v) !== key, reset: () => setV(src) };
}
export function SaveBar({ dirty, onSave, onReset, busy, disabled }: { dirty: boolean; onSave: () => void; onReset: () => void; busy: boolean; disabled?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="rg-save" role="region" aria-label="Enregistrer">
      <span className="grow">Modifications non enregistrées</span>
      <Button variant="ghost" onClick={onReset}>Annuler</Button>
      <Button variant="primary" busy={busy} disabled={disabled} onClick={onSave}>Enregistrer</Button>
    </div>
  );
}
export function useSave() {
  const { reloadBoot } = useApp();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>, msg = 'Réglages enregistrés') => {
    setBusy(true);
    try { await api.patch('/api/v1/settings', patch); toast({ title: msg, icon: 'check' }); refreshAll(); await reloadBoot(); return true; }
    catch (e) { toastError(e); return false; } finally { setBusy(false); }
  };
  return { busy, save };
}
export function Card({ title, icon, children, aside }: { title: string; icon: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="card col" style={{ gap: 12 }}><div className="card-h"><h2><Icon name={icon} size={16} />{title}</h2>{aside}</div>{children}</section>;
}
export const num = (x: string, min: number, max: number) => Math.max(min, Math.min(max, Number(x.replace(/\D/g, '')) || 0));
