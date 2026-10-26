// 05 · Le casting. The barbers as an end-credits roll: the role line is the first sentence of their own bio,
// and each name carries its real next free slot for a classic cut. Tapping it opens the sheet on that barber
// and that slot (the sheet re-checks it against the availability it already holds).
// The roll is drawn once per cast; the minute refresh only re-draws each barber's chip, so focus stays put.
import { cast, roleLine, bookAttrs, slotWords, type Cast } from '../data';
import { live, onLive } from '../live';
import { $, $$, esc, setText, swap, safeUrl, ARROW } from '../util';

const NUM = ['Zéro', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit'];

function acts(b: Cast) {
  const s = b.id ? live.byBarber[b.id] : undefined;
  // the visible label is the slot; the barber's name completes it for screen readers browsing by buttons
  const who = `<span class="sr-only"> avec ${esc(b.name)}</span>`;
  const chip = s
    ? `<button type="button" class="chip" ${bookAttrs({ slug: 'cl', staffId: b.id, day: s.day, start: s.start, source: 'film-cast-slot' })}><i class="live-dot${live.open ? '' : ' off'}"></i><span>Prochain créneau · ${esc(slotWords(s.day, s.start))}</span>${who}${ARROW}</button>`
    : `<button type="button" class="chip" ${bookAttrs({ slug: 'cl', staffId: b.id, staffKey: b.key, source: 'film-cast' })}><span>${live.castReady ? 'Voir ses disponibilités' : 'Ses disponibilités'}</span>${who}${ARROW}</button>`;
  const ig = safeUrl(b.instagram);
  return chip + (ig ? `<a class="lnk" href="${esc(ig)}" target="_blank" rel="noopener">Instagram<span class="sr-only"> de ${esc(b.name)}</span>${ARROW}</a>` : '');
}

export function mountCasting() {
  const roll = $('[data-cast]'), any = $('[data-any]');
  if (!roll || !any) return;
  const paint = () => {
    const list = cast();
    swap(roll, list.map((b, i) => `<li class="cs-c">
        <p class="cs-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
        <p class="cs-r">${esc(roleLine(b.bio))}</p>
        <h3 class="cs-name">${esc(b.name)}</h3>
        <div class="cs-acts"></div>
      </li>`).join(''));
    $$('.cs-acts', roll).forEach((el, i) => swap(el, acts(list[i])));
    setText($('[data-cast-lead]'), (NUM[list.length] || String(list.length)) + ' barbiers. Choisis le tien, ou prends le premier libre.');
    setText($('[data-cast-names]'), list.map((b) => b.name).join(', '));
    const n = live.next;
    swap(any, `<button type="button" class="btn" ${bookAttrs({ slug: 'cl', staffId: 'any', day: n?.day, start: n?.start, source: 'film-cast-any' })}>Le premier libre${n ? ' · ' + esc(slotWords(n.day, n.start)) : ''}</button>
      <p class="next-n">${n ? 'Coupe classique, avec le premier barbier disponible.' : 'Choisis ta prestation, on te trouve un fauteuil.'}</p>`);
  };
  onLive(paint);
}
