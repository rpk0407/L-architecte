// « Ta coupe en photo » in the client space, once he has come at least once: the same frame as on the page of a visit
// (web/src/client/photo.tsx). Made in the browser only: nothing is uploaded or kept.
import { PhotoFrame } from '../../client/photo';
import type { CardProps } from '../types';

export const meta = { id: 'photo', tab: 'home' as const, order: 80 };

export default function Photo({ me }: CardProps) {
  if (!me.rhythm || !me.rhythm.visits) return null;
  return <PhotoFrame shop={me.shop.name} />;
}
