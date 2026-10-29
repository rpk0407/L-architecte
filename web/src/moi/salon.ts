// What the signed-out /moi says of the salon: its phone and address (the footer, « Appeler le salon »), and which of the
// advantages it really offers (the promise lists only those). Read once from the public routes the site's own pages read
// (/api/public/salon, /api/public/memberships); with neither answering the page keeps its defaults and promises less.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export type SalonInfo = {
  name: string;
  /** the name the © line gives, as public/pages.js writes it: the legal name when the salon has one */
  editor: string;
  phone: string; email: string; address: string;
  /** a carnet is sold (at the salon, or online) */
  carnet: boolean;
  /** the monthly membership is sold online right now */
  membership: boolean;
};

const DEFAULTS: SalonInfo = { name: 'Barber L’Architecte', editor: 'Barber L’Architecte', phone: '', email: 'larchitectebarber@gmail.com', address: '16, place Pélabon, 13013 Marseille', carnet: false, membership: false };
let once: Promise<SalonInfo> | null = null;

export function loadSalon(): Promise<SalonInfo> {
  once ||= Promise.all([
    api.get<any>('/api/public/salon').catch(() => null),
    api.get<any>('/api/public/memberships').catch(() => null)
  ]).then(([s, m]) => {
    const sh = (s && s.shop) || {};
    const addr = [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const packs = ((s && s.services) || []).some((x: any) => x && x.pack && x.pack.credits);
    return {
      name: String(sh.name || sh.legalName || DEFAULTS.name),
      editor: String(sh.legalName || sh.name || DEFAULTS.editor),
      phone: String(sh.phone || ''),
      email: String(sh.email || DEFAULTS.email),
      address: addr || DEFAULTS.address,
      carnet: packs || !!(m && m.carnet),
      membership: !!(m && m.live)
    };
  });
  return once;
}

/** The salon's details, the defaults until they arrive. */
export function useSalon(): SalonInfo {
  const [info, setInfo] = useState<SalonInfo>(DEFAULTS);
  useEffect(() => { let on = true; loadSalon().then((i) => { if (on) setInfo(i); }); return () => { on = false; }; }, []);
  return info;
}
