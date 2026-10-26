// 04 · La preuve. The reviews run as subtitles over a darkened still, one per third of the scroll, the client's
// own words in italic. The rating is stamped (index.html, data-reveal), the number of reviews counts up once.
// Only what content.ts holds (Google: 5,0 · 316 avis).
import { REVIEWS, REVIEW_TAGS } from '../../../site-kit/content';
import { track, countUp, reduced } from '../../../site-kit/motion';
import { $, $$, esc } from '../util';

export function mountPreuve() {
  const sec = $('#preuve');
  if (!sec) return;
  $('[data-reviews]', sec)!.innerHTML = REVIEWS.map((r) => `<li class="pv-s">
      <blockquote><p>«&nbsp;${esc(r.before)}<em>${esc(r.em)}</em>${esc(r.after)}&nbsp;»</p></blockquote>
      <p class="pv-who">— ${esc(r.name)} <span>· Avis Google · ${esc(r.date)}</span></p>
    </li>`).join('');
  $('[data-tags]', sec)!.innerHTML = REVIEW_TAGS.map((t) => `<li>${esc(t)}</li>`).join('');
  // only whole counts are counted: a rating shown mid-count would state a worse score than the real one
  $$<HTMLElement>('[data-count]:not([data-dec])', sec).forEach((el) => countUp(el, Number(el.dataset.count), { ms: 1600 }));
  const subs = $$('.pv-s', sec);
  if (reduced()) { subs.forEach((s) => s.classList.add('is-on')); return; }
  let cur = -1;
  track(sec, (p) => {
    const i = Math.min(subs.length - 1, Math.floor(p * subs.length * 0.999));
    if (i !== cur) { cur = i; subs.forEach((s, j) => s.classList.toggle('is-on', j === i)); }
  }, 'sticky');
}
