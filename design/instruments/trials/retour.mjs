// L’épreuve du retour: the thumb swipes back, a link from Instagram lands deep inside the sheet, a keyboard is all he has.
//
// A booking sheet is a place inside a page: people leave it with the browser’s back gesture, arrive at it from a shared link,
// and the ones who cannot use a screen move through it with the keyboard. Four ways in and out, each of which has to work:
//   back      the browser’s Back, with the sheet open, arriving from somewhere else (it must close the sheet, not leave the site)
//   deeplink  /?reserver, and /?reserver&barbier=…&prestation=… (an Instagram bio, the old site, a QR code on the door)
//   escape    Esc closes the sheet and hands focus back to the button that opened it
//   trap      Tab stays inside the open sheet (a modal that leaks focus is a page behind a curtain)
import { SEL } from '../lib/surface.mjs';

export const meta = {
  id: 'retour', fr: 'L’épreuve du retour', en: 'The way back', driver: 'scenes',
  summary: 'Browser Back with the sheet open, deep links into it, Escape, and keyboard focus kept inside it.'
};

const stepOf = async (page) => (await page.locator(SEL.stepLabel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

export async function run(h) {
  const scenes = h.scenes('retour');
  for (const scene of scenes) {
    // 1 · Back, arriving from elsewhere (a search result, a shared link)
    let s = await h.open(scene);
    await s.page.goto(s.base + '/robots.txt');
    await s.goto('/');
    await s.page.waitForTimeout(1500);
    const home = s.page.url();
    await s.page.locator(SEL.cta).first().tap();
    await s.page.locator(SEL.service).first().waitFor({ state: 'visible' });
    await s.page.goBack();
    await s.page.waitForTimeout(1200);
    const after = s.page.url();
    const stayed = after === home;
    const stillOpen = stayed && (await s.page.locator(SEL.service).first().isVisible().catch(() => false));
    const shot = await h.shot(s.page, 'After pressing Back with the sheet open', { scene: scene.id });
    h.check({
      id: 'retour.back', axis: 'usability', weight: 3, personas: ['presse', 'fidele', 'parent', 'nouveau'], scene: scene.id,
      title: 'Pressing the browser’s Back with the booking sheet open closes the sheet; it does not leave the site',
      why: 'On a phone the back gesture is the way out of anything. If it throws him off the site he loses the slot and the form, and learns not to trust the sheet.',
      status: stayed && !stillOpen ? 'pass' : stayed ? 'warn' : 'fail', value: stayed ? (stillOpen ? 'stayed, sheet still open' : 'closed the sheet') : 'left the site', detail: `from ${home.replace(s.base, '')} to ${after.replace(s.base, '') || '/'}`, evidence: [shot],
      fix: 'When the sheet opens, history.pushState({ sheet: true }); on popstate close it; when it closes by ✕ or Esc, history.back() only if the state is the sheet’s.'
    });
    await s.close();

    // 2 · deep links
    s = await h.open(scene);
    await s.goto('/?reserver');
    const opens = await s.page.locator(SEL.service).first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
    await s.close();
    s = await h.open(scene);
    await s.goto('/?reserver&barbier=jkut&prestation=cl'); // the catalogue’s own short code for « Coupe classique »
    await s.page.waitForTimeout(2500);
    const deep = await s.page.evaluate((sel) => ({ step: (document.querySelector(sel.step) || {}).textContent || '', foot: (document.querySelector(sel.foot) || {}).textContent || '' }), { step: SEL.stepLabel, foot: SEL.footer });
    const pre = /jkut/i.test(deep.foot) && /coupe/i.test(deep.foot);
    const deepShot = await h.shot(s.page, 'A link with a barber and a service in it', { scene: scene.id });
    await s.close();
    h.check({ id: 'retour.deeplink', axis: 'usability', weight: 3, personas: ['passionne', 'fidele', 'nouveau'], scene: scene.id, protect: opens && pre,
      title: 'A shared link opens the booking sheet, and can carry a barber and a service with it',
      why: 'The Instagram bio, the QR code on the door and the old site all point here; a link that lands on the home page is a link that loses people.',
      status: opens && pre ? 'pass' : opens ? 'warn' : 'fail', value: `/?reserver ${opens ? 'opens' : 'does not open'} the sheet · with barbier and prestation: ${pre ? 'preselected' : 'not preselected'}`,
      detail: `landed on: ${deep.step.replace(/\s+/g, ' ').trim()} · footer: ${deep.foot.replace(/\s+/g, ' ').trim().slice(0, 80)}`, evidence: [deepShot] });

    // the code in the page’s own comment reads like a name; does it work?
    s = await h.open(scene);
    await s.goto('/?reserver&prestation=coupe-classique');
    await s.page.waitForTimeout(2200);
    const named = await s.page.evaluate((foot) => (document.querySelector(foot) || {}).textContent || '', SEL.footer);
    await s.close();
    h.check({ id: 'retour.deeplink-readable', axis: 'content', weight: 1, personas: ['passionne'], scene: scene.id, decision: true,
      title: 'A link written with the service’s name (prestation=coupe-classique) preselects it, as the page’s own comment promises',
      why: 'A barber pastes this link into an Instagram bio by hand; short codes (cl, cc, ct) cannot be guessed or read, and the comment in site.html shows a form that does not work.',
      status: /coupe/i.test(named) ? 'pass' : 'warn', value: /coupe/i.test(named) ? 'the name works' : 'only the catalogue’s short codes work (cl, cc, ct, tr…)', detail: `footer after loading the named link: ${named.replace(/\s+/g, ' ').trim().slice(0, 60)}`,
      fix: 'Accept the slugified service name as well as the short code in serviceOf(), or correct the example in the comment and give barbers a page that generates their links.' });

    // 3 · Escape, and where focus goes
    s = await h.open(scene);
    await s.goto('/');
    await s.page.waitForTimeout(1500);
    await s.page.locator(SEL.cta).first().focus();
    await s.page.keyboard.press('Enter');
    await s.page.locator(SEL.service).first().waitFor({ state: 'visible' });
    await s.page.waitForTimeout(900); // focus moves into the sheet when its opening transition ends
    const startFocus = await s.page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : ''; });
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(700);
    const closed = !(await s.page.locator(SEL.service).first().isVisible().catch(() => false));
    const back = await s.page.evaluate(() => { const a = document.activeElement; return a ? { cls: String(a.className || ''), tag: a.tagName, inCta: !!a.closest('.cta') } : null; });
    h.check({ id: 'retour.escape', axis: 'usability', weight: 2, personas: ['ancien', 'passionne'], scene: scene.id, protect: closed && !!(back && back.inCta),
      title: 'Escape closes the sheet and returns focus to the button that opened it',
      why: 'A keyboard user who is dropped at the top of the page has lost his place in a page he cannot see.',
      status: closed && back && back.inCta ? 'pass' : closed ? 'warn' : 'fail', value: closed ? (back && back.inCta ? 'closed, focus back on “Réserver”' : `closed, focus on ${back ? back.tag : 'nothing'}`) : 'did not close' });
    h.check({ id: 'retour.focus-start', axis: 'usability', weight: 1, personas: ['ancien'], scene: scene.id, protect: startFocus === 'bk-t',
      title: 'Opening the sheet moves focus to its title, so a screen reader starts where the sheet starts',
      why: 'Without it, a screen reader keeps reading the page behind the curtain.',
      status: startFocus === 'bk-t' ? 'pass' : 'warn', value: startFocus });

    // 4 · Tab stays inside the open sheet
    await s.page.locator(SEL.cta).first().focus();
    await s.page.keyboard.press('Enter');
    await s.page.locator(SEL.service).first().waitFor({ state: 'visible' });
    await s.page.waitForTimeout(900);
    let outside = 0, stops = 0;
    for (let i = 0; i < 28; i++) {
      await s.page.keyboard.press('Tab');
      const inside = await s.page.evaluate(() => { const a = document.activeElement; return !!(a && a.closest('[role="dialog"]')); });
      stops++;
      if (!inside) outside++;
    }
    h.check({ id: 'retour.trap', axis: 'usability', weight: 3, personas: ['ancien', 'passionne'], scene: scene.id, protect: outside === 0,
      title: 'While the sheet is open, Tab never leaves it',
      why: 'A modal that leaks focus is a page behind a curtain: the keyboard user is typing into something he cannot see.',
      status: outside === 0 ? 'pass' : 'fail', value: outside, unit: `of ${stops} Tab presses landed outside the dialog`, threshold: '0' });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['presse'] };
}
