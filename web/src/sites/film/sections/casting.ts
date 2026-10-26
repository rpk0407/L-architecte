// 05 · Le casting. The barbers as an end-credits roll: the role line is the first sentence of their own bio,
// and each name carries its real next free slot for a classic cut. Tapping it opens the sheet on that barber
// and that slot (the sheet re-checks it against the availability it already holds).
import { cast, roleLine, bookAttrs, slotWords } from '../data';
import { live, onLive } from '../live';
import { $, esc, setText, ARROW } from '../util';

const NUM = ['Zéro', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit'];

function slotChip(id: string | null, key: string) {
  const s = id ? live.byBarber[id] : undefined;
  if (s) return `<button type="button" class="chip" ${bookAttrs({ slug: 'cl', staffId: id, day: s.day, start: s.start, source: 'film-cast-slot' })}><i class="live-dot"></i><span>Prochain créneau · ${esc(slotWords(s.day, s.start))}</span>${ARROW}</button>`;
  const label = live.slotsReady ? 'Voir ses disponibilités' : 'Ses disponibilités';
  return `<button type="button" class="chip" ${bookAttrs({ slug: 'cl', staffId: id, staffKey: key, source: 'film-cast' })}><span>${label}</span>${ARROW}</button>`;
}

export function mountCasting() {
  const roll = $('[data-cast]'), any = $('[data-any]');
  if (!roll || !any) return;
  const paint = () => {
    const list = cast();
    const html = list.map((b, i) => `<li class="cs-c">
        <p class="cs-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p>
        <p class="cs-r">${esc(roleLine(b.bio))}</p>
        <h3 class="cs-name">${esc(b.name)}</h3>
        <div class="cs-acts">${slotChip(b.id, b.key)}${b.instagram ? `<a class="lnk" href="${esc(b.instagram)}" target="_blank" rel="noopener">Instagram${ARROW}</a>` : ''}</div>
      </li>`).join('');
    if (roll.dataset.html !== html) {
      // keep focus on the chip that was focused (same barber) when the slots refresh
      const had = roll.contains(document.activeElement) ? Array.from(roll.children).indexOf((document.activeElement as Element).closest('.cs-c')!) : -1;
      roll.dataset.html = html;
      roll.innerHTML = html;
      if (had >= 0) (roll.children[had]?.querySelector('.chip') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    setText($('[data-cast-lead]'), (NUM[list.length] || String(list.length)) + ' barbiers, une même exigence. Touche un créneau, il est à toi.');
    setText($('[data-cast-names]'), list.map((b) => b.name).join(', '));
    const n = live.next;
    const anyHtml = `<button type="button" class="btn" ${bookAttrs({ slug: 'cl', staffId: 'any', day: n?.day, start: n?.start, source: 'film-cast-any' })}>Le premier libre${n ? ' · ' + esc(slotWords(n.day, n.start)) : ''}</button>
      <p class="next-n">${n ? 'Coupe classique, avec le premier barbier disponible.' : 'Choisis ta prestation, on te trouve un fauteuil.'}</p>`;
    if (any.dataset.html !== anyHtml) { any.dataset.html = anyHtml; any.innerHTML = anyHtml; }
  };
  onLive(paint);
}
