// L’épreuve du clavier: the keyboard is half the screen; can he still see what he types?
//
// The booking sheet has a sticky footer (price and the “Confirmer” button). Open the keyboard and the viewport is half as tall:
// a focused field can end up under that footer, and a person typing his number blind is a person who mistypes it. Emulated by
// shortening the viewport to 520 px, as Android Chrome does when the keyboard opens (iOS Safari shrinks only the visual viewport,
// where the same overlap shows up as the field hiding behind the bar).
import { SEL } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';

export const meta = {
  id: 'clavier', fr: 'L’épreuve du clavier', en: 'The keyboard test', driver: 'scenes',
  summary: 'A focused field and the confirm button, with the keyboard open (viewport 390×520).'
};

export async function run(h) {
  const scenes = h.scenes('clavier');
  for (const scene of scenes) {
    const s = await h.open(scene, { device: 'phone-keyboard' });
    await s.goto('/');
    await s.page.waitForTimeout(1500);
    const b = new Booking(s);
    await b.open();
    await b.service(0);
    await b.who(0);
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    await b.holdReady();

    // the first tap on a field, before anything has been scrolled: the browser scrolls a focused field into the viewport only if it is
    // outside it, and the sticky footer is not something it knows about, so a field in the footer’s shadow stays where it is
    const seen = {};
    for (const [name, sel] of [['phone number', SEL.phone], ['first name', SEL.first]]) {
      await s.page.evaluate(() => { const b = document.querySelector('.bk-body'); if (b) b.scrollTop = 0; });
      await s.page.locator(sel).focus();
      await s.page.waitForTimeout(450);
      seen[name] = await s.page.evaluate(([field, foot, confirm]) => {
        const f = document.querySelector(field).getBoundingClientRect();
        const ft = document.querySelector(foot).getBoundingClientRect();
        const c = document.querySelector(confirm).getBoundingClientRect();
        const top = Math.max(f.top, 0), bottom = Math.min(f.bottom, ft.top, innerHeight);
        return { visible: Math.max(0, bottom - top) / f.height, fieldTop: Math.round(f.top), fieldBottom: Math.round(f.bottom), footTop: Math.round(ft.top), vh: innerHeight, confirmInView: c.top >= 0 && c.bottom <= innerHeight };
      }, [sel, SEL.footer, SEL.confirm]);
      if (name === 'phone number') var shotPhone = await h.shot(s.page, 'The phone field with the keyboard open (viewport 390×520)', { scene: scene.id });
    }
    const shot = shotPhone;
    const worst = Math.min(...Object.values(seen).map((x) => x.visible));
    const phone = seen['phone number'];
    h.check({
      id: 'clavier.field', axis: 'usability', weight: 3, personas: ['presse', 'parent', 'ancien', 'nouveau'], scene: scene.id,
      title: 'With the keyboard open, the field he is typing in stays visible above the sticky footer',
      why: 'A number typed blind is a number mistyped; the details step has one job, and it is to be seen while it is done.',
      status: worst >= 0.9 ? 'pass' : worst >= 0.5 ? 'warn' : 'fail', value: Math.round(worst * 100), unit: '% of the field visible', threshold: '≥ 90%',
      detail: `phone field y ${phone.fieldTop}–${phone.fieldBottom}, footer starts at y ${phone.footTop}, viewport ${phone.vh} px · emulated: viewport shortened to 520 px`, data: seen, evidence: [shot],
      fix: 'On .bk-body, `scroll-padding-bottom` equal to the footer’s height (plus 16 px), so a focused field scrolls to above the footer; or scrollIntoView({ block: "center" }) on focus.'
    });
    h.check({
      id: 'clavier.confirm', axis: 'usability', weight: 3, personas: ['presse', 'parent'], scene: scene.id, protect: true,
      title: 'With the keyboard open, the “Confirmer” button is still on screen',
      why: 'The last tap of the flow must never be one he has to hunt for with the keyboard in the way.',
      status: phone.confirmInView ? 'pass' : 'fail', value: phone.confirmInView ? 'in view' : 'off screen', evidence: [shot]
    });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['presse'] };
}
