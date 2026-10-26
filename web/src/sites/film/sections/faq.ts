// 08 · Questions. Native disclosures (keyboard and screen readers for free), one open at a time.
import { FAQ, SHOP } from '../../../site-kit/content';
import { $, esc, ARROW } from '../util';

export function mountFaq() {
  const box = $('[data-faq]');
  if (!box) return;
  box.innerHTML = FAQ.map((f, i) => `<details class="fq-i" name="faq">
      <summary><span class="fq-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="fq-q">${esc(f.q)}</span><span class="fq-ic" aria-hidden="true"><i></i><i></i></span></summary>
      <div class="fq-a"><p>${esc(f.a)}</p>${/place Pélabon/.test(f.a) ? `<a class="lnk" href="${esc(SHOP.maps)}" target="_blank" rel="noopener">Ouvrir dans Maps${ARROW}</a>` : ''}</div>
    </details>`).join('');
}
