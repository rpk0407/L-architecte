// The words that explain the team's figures, from the copy the server's tests check (shared/figures.js).
// @ts-ignore — plain JS module with JSDoc types
import * as F from '../../../shared/figures.js';
import type { Gap } from '../comptoir/types';

const f = F as { gapWords(r: { revenue: number; performed?: number; gap?: Gap }): string; rulesWords(r: { base: string; cutCredit: string }): string };
/** « Réalisé par l’équipe 8 420 € · Encaissé 8 900 € · écart : carnets et abonnements vendus 640 €, consommés 160 € » */
export const gapWords = f.gapWords;
/** « Commission sur le prix HT · coupes de carnet pour qui coupe » */
export const rulesWords = f.rulesWords;
