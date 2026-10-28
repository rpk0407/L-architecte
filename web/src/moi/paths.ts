// /moi's addresses: one per tab (no router library: the path is read, history.pushState moves), and ?next=, where a
// deep link from a text or another page (a membership's « Résilier », a loyalty card) goes once signed in.
import type { MoiCardMeta } from './types';

export type Tab = MoiCardMeta['tab'];
export const PATHS: Record<Tab, string> = { home: '/moi', history: '/moi/historique', profile: '/moi/profil' };

/** The tab of a /moi path: /moi/historique…, /moi/profil…, anything else under /moi is « Rendez-vous ». */
export function tabOf(path: string): Tab {
  if (/^\/moi\/historique(\/|$)/.test(path)) return 'history';
  if (/^\/moi\/profil(\/|$)/.test(path)) return 'profile';
  return 'home';
}

/** ?next= kept only when it is a path of /moi on this site (never an open redirect); its query and hash stay. */
export function safeNext(raw: string | null | undefined, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let u: URL;
  try { u = new URL(raw, origin); } catch { return null; }
  if (u.origin !== origin || !/^\/moi(\/|$)/.test(u.pathname)) return null;
  return u.pathname + u.search + u.hash;
}
