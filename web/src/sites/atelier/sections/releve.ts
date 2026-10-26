// Planche 05, the survey: the Google score as a measured rule, the reviews as annotated notes (the
// phrase that matters underlined in red, pinned to a margin note), and what comes back in the reviews.
// Only what content.ts holds: 5,0 · 316 avis and three real quotes. The figures never count up (a
// counter would show numbers that are not true); only the rule moves.
import { REVIEWS, REVIEW_TAGS } from '../../../site-kit/content';
import { reduced } from '../../../site-kit/motion';
import { $, h, fr, NB } from '../util';

export function mountReleve() {
  const sec = $('#releve')!, notes = $('[data-notes]')!, tags = $('[data-tags]')!;
  notes.replaceChildren(...REVIEWS.map((r, i) => h('li', { class: 'note', 'data-reveal': '', 'data-delay': i * 110 },
    h('p', { class: 'note-k' }, h('span', { class: 'pl' }, 'Note ' + String(i + 1).padStart(2, '0')), h('span', null, 'Avis Google · ' + r.date)),
    h('blockquote', null, h('p', null, '«' + NB + fr(r.before), h('em', null, r.em), fr(r.after) + NB + '»')),
    h('p', { class: 'note-by' }, h('span', { class: 'note-av', 'aria-hidden': 'true' }, r.initial), r.name))));
  tags.replaceChildren(...REVIEW_TAGS.map((t) => h('li', null, t)));

  // the rule fills once the score is on screen
  const score = $('.rv-score', sec)!;
  if (reduced()) score.classList.add('go');
  else new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { score.classList.add('go'); o.disconnect(); } }, { threshold: 0.5 }).observe(score);
}
