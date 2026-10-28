// The client's loyalty card, as /moi's two pieces (the « Mes avantages » row and the Profil switch) read it: GET
// /api/me/loyalty once per screen, and POST /api/me/loyalty/off for the right not to take part.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MeLoyalty } from '../lib/loyalty';

type Shown = Extract<MeLoyalty, { enabled: true }>;
/** data: the card while the programme runs, null while it is off or the answer is not there (nothing is drawn then). */
export function useMeLoyalty() {
  const [data, setData] = useState<Shown | null>(null);
  const [ready, setReady] = useState(false);
  const load = useCallback(() => api.get<MeLoyalty>('/api/me/loyalty').then((r) => setData(r.enabled ? r : null)).catch(() => setData(null)).finally(() => setReady(true)), []);
  useEffect(() => { load(); }, [load]);
  return { data, ready, reload: load, set: (patch: Partial<Shown>) => setData((d) => (d ? { ...d, ...patch } : d)) };
}

/** « Participer à la carte fidélité »: off or on again. demo: the showcase's client changes nothing for the next visitor. */
export const setLoyaltyOff = (off: boolean) => api.post<{ ok: true; off: boolean; demo?: true }>('/api/me/loyalty/off', { off });
