// The loyalty card (FID-03), drawn the same in the Comptoir, in /moi and on the receipt page: one ring per stamp (filled =
// earned), then a last ring with a gift, the reward itself; or a progress bar for points and for very long cards.
// Its accessible name is the count, « 6 tampons sur 9 »: the rings are decoration.
import { Icon } from './Icon';
import { stampsLabel } from '../lib/loyalty';
import './stampcard.css';

/** More rings than this and a bar reads better than a crowd. */
const MAX_RINGS = 24;

export function StampCard({ units, goal, model = 'stamps', size = 'md' }: { units: number; goal: number; model?: 'stamps' | 'points'; size?: 'sm' | 'md' }) {
  const have = Math.max(0, Math.min(units, goal));
  const label = stampsLabel(units, goal, model);
  if (model === 'points' || goal > MAX_RINGS) {
    return <span className={'stampcard bar ' + size} role="img" aria-label={label}><b aria-hidden><i style={{ ['--w' as string]: (goal ? Math.round((have / goal) * 100) : 0) + '%' }} /></b></span>;
  }
  return (
    <span className={'stampcard ' + size} role="img" aria-label={label}>
      {Array.from({ length: goal }, (_, n) => <i key={n} className={n < have ? 'on' : ''} aria-hidden>{n < have && size === 'md' ? <Icon name="check" /> : null}</i>)}
      <i className={'rwd' + (have >= goal ? ' on' : '')} aria-hidden><Icon name="gift" /></i>
    </span>
  );
}
