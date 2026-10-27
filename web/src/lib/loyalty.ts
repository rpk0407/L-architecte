// The loyalty card in the Comptoir and in /moi (FID-03): the shapes the loyalty routes answer, and the French words around
// shared/loyalty.js (the file the server and the receipt text use too), so Réglages, the till, the client file and the
// client's own page all read alike. The arithmetic stays in shared/loyalty.js: rewardValue is what the till applies.
// @ts-ignore — plain JS module with JSDoc types
import * as L from '../../../shared/loyalty.js';

/** A reward as the settings hold it: a service offered (one of `refs`, any if none), up to `cap` cents (0: the whole price), or an amount off. */
export type Reward = { kind: 'service' | 'amount'; refs?: string[]; cap?: number; amount?: number };
/** settings.loyalty (server/settings/loyalty.js). v1 is stamps only. */
export type LoyaltyCfg = {
  enabled: boolean; goal: number; minNet: number; reward: Reward; rewardDays: number; resetDays: number; headStart: 'none' | 'half' | 'full';
  referral: { enabled: boolean; referrer: Reward; referee: Reward; perYear: number };
};
export type CardReward = { id: string; source: 'card' | 'gift' | 'referrer' | 'referee' | 'birthday'; reward: Reward; label: string; expires: string };
export type CardMove = { day: string; what: string; units: number };
/** GET /api/v1/loyalty/client/:id, with who referred him and how many he referred. */
export type ClientLoyalty = {
  root: string; model: 'stamps'; enabled: boolean; off: boolean; units: number; goal: number; rewards: CardReward[]; last: CardMove[]; lastEarn: string | null; referredBy: string | null;
  referral: { by: { id: string; name: string } | null; count: number };
  /** the rule a barber may not read in the settings: what a stamp needs paid, and whether the till asks « Quelqu’un t’a envoyé ? » */
  minNet: number; referralOn: boolean;
};
/** ClientCard.loyalty (server/domain/loyalty.js cardLine): the card in one line, absent while the programme is off. */
export type CardLine = { units: number; goal: number; rewards: number; off: boolean };
/** GET /api/me/loyalty (server/http/routes-me-loyalty.js). */
export type MeLoyalty =
  | { enabled: false }
  | {
    enabled: true; off: boolean; card: { units: number; goal: number; model: 'stamps' }; rule: string; headline: string; terms: string[];
    rewards: { id: string; label: string; expires: string }[]; referral: { link: string; offer: string; count: number } | null; birthdayMissing: boolean;
  };
/** GET /api/v1/loyalty/launch: what launching now would give, or what it gave. */
export type LaunchView = { launched: { day: string; headStart: string; clients: number; stamps: number } | null; plan: { headStart: string; cap: number; clients: number; stamps: number } | null };
/** GET /api/v1/loyalty/simulate */
export type Simulation = { from: string; to: string; clients: number; winners: number; rewards: number; value: number; share: number; perClientYear: number };

type Words = (id: string) => string;
const W = L as {
  rewardWords(r: Reward, nameOf?: Words): string; cardWords(c: { units: number; goal: number; model?: string; off?: boolean; rewards?: { reward?: Reward }[] }): string;
  rewardValue(r: Reward, line: { kind: string; ref?: string | null; unit: number; qty?: number; discount?: number }): number;
  ruleWords(cfg: Pick<LoyaltyCfg, 'goal' | 'reward'>, nameOf?: Words): string; termsText(cfg: Omit<LoyaltyCfg, 'enabled' | 'headStart'>, nameOf?: Words): string[];
  headlineWords(card: { units: number; goal: number; rewards?: { reward: Reward; expires: string }[] }, cfg: Pick<LoyaltyCfg, 'reward'>): string;
  dayWords(day: string): string; lapseWords(days: number): string;
};
/** « Coupe classique offerte », « Une prestation offerte (jusqu’à 25 €) », « 5 € offerts » */
export const rewardWords = W.rewardWords;
/** What a reward takes off a line, in cents: the till applies exactly this, the server checks it. */
export const rewardValue = W.rewardValue;
/** « 9 passages = la 10e coupe offerte » */
export const ruleWords = W.ruleWords;
/** The règlement, one paragraph per entry (Réglages shows the same text /moi shows). */
export const termsText = W.termsText;
/** « Encore 3 passages avant ta coupe offerte » or « Ta coupe offerte t’attend jusqu’au 12 mai » */
export const headlineWords = W.headlineWords;
/** « 12 mai », « 1er mars » */
export const dayWords = W.dayWords;
/** « 6 mois », « 45 jours » */
export const lapseWords = W.lapseWords;

/** « 6 tampons sur 9 » (0 or 1: « tampon »): the card's accessible name, wherever a StampCard is drawn. */
export const stampsLabel = (units: number, goal: number, model: 'stamps' | 'points' = 'stamps') =>
  Math.max(0, units) + (model === 'points' ? ' point' : ' tampon') + (units > 1 ? 's' : '') + ' sur ' + goal;

/** 'Visite' → « passage », a reward used → « coupe offerte »: the card's movements as the client file lists them. */
export function moveWords(what: string): string {
  if (what === 'Visite') return 'passage';
  if (what === 'Remboursement du ticket') return 'remboursement';
  if (what === 'Reprise de la carte au lancement') return 'reprise au lancement';
  if (what === 'Repris de l’ancien site') return 'repris de l’ancien site';
  if (what.startsWith('Carte complète')) return 'carte complète';
  if (what.startsWith('Récompense utilisée')) {
    const r = what.split(' · ')[1] || '';
    // a reward that names no service pays "a cut" for the salon's clients
    return !r || r.startsWith('Une prestation') ? 'coupe offerte' : r.charAt(0).toLowerCase() + r.slice(1);
  }
  return what.charAt(0).toLowerCase() + what.slice(1);
}
