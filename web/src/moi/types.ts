// The client space's shapes (AC-01): what /api/me/* and /api/public/account/* answer (server/domain/me.js,
// server/http/routes-me.js), and the module shapes of /moi's folder registries (INDEX › Shared contracts). Money in
// cents, days as YYYY-MM-DD, times as minutes after midnight, instants as ms.
import type { ComponentType } from 'react';

export type MeStaff = { id: string; name: string; initials: string; color: string };
export type MeService = { id: string; name: string; price: number };
export type ApptStatus = 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show' | 'cancelled';

/** A booking to come: token/manage are its /r/ link, so moving, cancelling and paying reuse the public token routes. */
export type MeUpcoming = {
  id: string; code: string; token: string; manage: string; day: string; start: number; dur: number; status: 'pending' | 'booked';
  services: MeService[]; price: number; staff: MeStaff | null; anyStaff: boolean;
  deposit: { amount: number; paid: number; url: string | null } | null;
  /** changeUntil: until when it can be moved or cancelled online (ms); lateOk: « J’ai du retard » makes sense now (AC-04) */
  canChange: boolean; changeUntil: number; lateOk: boolean;
};

export type MeCarnet = { id: string; name: string; left: number; total: number; expires: string };
export type MeGiftcard = { id: string; last4: string; balance: number; expires: string };

/** GET /api/me/home. fenced: an account opened on a file that may have changed hands; nothing before historyFrom shows. */
export type Me = {
  first: string; last: string; birthday: string; since: number; fenced: boolean; historyFrom: string | null;
  consent: { sms: boolean; marketing: boolean; marketingAt: number | null };
  prefs: { staffId: string | null };
  /** dueDay: null below 2 done visits (server/domain/rhythm.js rhythmOf, the salon's rule too) */
  rhythm: { visits: number; cadence: number | null; lastDay: string | null; dueDay: string | null };
  usual: { serviceIds: string[]; staffId: string | null } | null;
  upcoming: MeUpcoming[];
  wallet: { carnets: MeCarnet[]; giftcards: MeGiftcard[] };
  team: MeStaff[];
  shop: { name: string; address: string; phone: string; mapsUrl: string };
  demo: boolean;
};

/** GET /api/me/history?before=YYYY-MM-DD: newest first; more → ask again with before = the last item's day. */
export type MeHistoryItem = { day: string; start: number; services: MeService[]; staff: MeStaff | null; price: number; paid: number; status: 'done' | 'no_show' | 'cancelled'; receipt: string | null };
export type MeHistory = { items: MeHistoryItem[]; more: boolean };

/** GET /api/me */
export type MeSession = { first: string; last: string; phone: string; since: number; fenced: boolean; historyFrom: string | null; named: boolean; demo: boolean };

/** GET /api/public/account: the entry points hide when enabled is false. */
export type AccountState = { enabled: boolean; signedIn: boolean; first?: string; demo: boolean };
/** POST /api/public/account/start | keep | verify. demoCode: the demo only (the persona, or a visitor's own fresh booking). */
export type StartAnswer = { ok: true; message: string; demoCode?: string };
export type KeepAnswer = { ok: true; sentTo: string; demoCode?: string };
/** ask 'first': the right code at a first opening, « Ton prénom ? » (send the same code again with first). */
export type VerifyAnswer = { ok: true; first: string } | { ok: false; ask: 'first'; message: string };

/** What every card of a /moi tab receives. */
export type CardProps = { me: Me; reload: () => void };

/** web/src/moi/cards/*.tsx: home orders next 10, rebook 20, avantages 30; profile: profile 10, calendar 20, loyalty-off 40, install 90. */
export type MoiCardMeta = { id: string; tab: 'home' | 'history' | 'profile'; order: number };
export type MoiCardModule = { meta: MoiCardMeta; default: ComponentType<CardProps> };

/** web/src/moi/avantages/*.tsx, the rows of the one « Mes avantages » card: membership 10, carnet 20, loyalty 30, giftcard 40. */
export type AvantageMeta = { id: string; order: number };
export type AvantageModule = { meta: AvantageMeta; default: ComponentType<CardProps> };
