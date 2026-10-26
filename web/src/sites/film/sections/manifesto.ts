// 01 · Prends place. The method in three sentences, lit word by word by the scroll; the three steps
// (diagnostic, construction, finition) switch on as their sentence is read.
import { track, splitWords, span, reduced } from '../../../site-kit/motion';
import { $, $$ } from '../util';

export function mountManifesto() {
  const sec = $('#prends-place'), txt = $('[data-split]', sec || document);
  if (!sec || !txt) return;
  const n = splitWords(txt);
  const steps = $$('.mf-steps li', sec);
  // a sentence starts after each word ending with a full stop
  const starts = [0];
  $$('.w', txt).forEach((w, i) => { if (/\.$/.test(w.textContent || '') && i < n - 1) starts.push(i + 1); });
  if (reduced()) { txt.style.setProperty('--k', String(n + 4)); steps.forEach((s) => s.classList.add('is-on')); return; }
  track(sec, (p) => {
    const k = span(p, 0.06, 0.78) * (n + 3);
    txt.style.setProperty('--k', k.toFixed(2));
    steps.forEach((s, i) => s.classList.toggle('is-on', k > (starts[i] ?? n) + 0.5));
  }, 'sticky');
}
