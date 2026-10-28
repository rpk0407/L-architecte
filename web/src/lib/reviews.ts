// The Google review link, checked the server's way (shared/reviews.js), and the words the Comptoir uses about it.
// @ts-ignore — plain JS module with JSDoc types
import * as R from '../../../shared/reviews.js';

export type ReviewLinkKind = 'placeid' | 'gpage' | 'maps' | '';
/** Which kind of Google review page a link opens, or '' when it is not one. */
export const reviewLinkKind = (url: string) => (R as { reviewLinkKind(u: string): ReviewLinkKind }).reviewLinkKind(url);
export const REVIEW_KIND: Record<Exclude<ReviewLinkKind, ''>, string> = { placeid: 'le formulaire d’avis de ta fiche', gpage: 'le lien court de Google Business Profile', maps: 'un lien court Google Maps' };
/** Where the owner finds the right link. */
export const REVIEW_HOWTO = 'Dans Google Business Profile › Demander des avis › copier le lien';
/** The length of a real tracked link (/avis/<message id>.<signature>), to count the SMS as it will leave. */
export const sampleReviewLink = (origin: string) => origin.replace(/\/+$/, '') + '/avis/msg_rev_cl_mvqgbw0v1jm5vI6W_2026-4.Ab3dEf9hIj2kLm4nOp6qRs';
