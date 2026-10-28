// « Mes avantages »: one card for everything the client holds. Its rows are the files of web/src/moi/avantages (membership
// 10, carnet 20, loyalty 30, gift card 40), each rendering nothing when it has nothing to show; the card hides itself
// when no row shows anything (some rows fetch their own route, so it is checked on the rendered rows, not guessed). Each
// row has its own guard: a row that breaks (another area's, on its own route) leaves the others in place.
import { useLayoutEffect, useRef, useState } from 'react';
import { avantagesOf } from '../registry';
import { Guard } from '../kit';
import type { AvantageModule, CardProps } from '../types';

export const meta = { id: 'avantages', tab: 'home' as const, order: 30 };

let rows: AvantageModule[] | null = null;
const allRows = () => (rows ||= avantagesOf(import.meta.glob('../avantages/*.tsx', { eager: true })));

export default function Avantages(props: CardProps) {
  const list = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => setEmpty(el.childElementCount === 0);
    check();
    const watch = new MutationObserver(check);
    watch.observe(el, { childList: true });
    return () => watch.disconnect();
  }, []);
  return (
    <section className="c-card m-avs" hidden={empty} aria-labelledby="m-avs-t" data-guide="moi.avantages">
      <h2 className="c-k" id="m-avs-t">Mes avantages</h2>
      <div className="m-avs-list" ref={list}>
        {allRows().map((R) => <Guard key={R.meta.id}><R.default {...props} /></Guard>)}
      </div>
    </section>
  );
}
