// WP8 · The list pattern's state, without a browser (web/src/ui/list-state.ts, used by ui/ListKit.tsx): what is
// selected (rows ticked one by one, or « everything this filter matches » minus the rows unticked), what the bulk
// request carries, the pages by offset, the saved views, and what « Annuler » sends back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE, NONE, start, stop, toggle, isSelected, count, selectAll, clear, forFilter, syncTotal, target, pageOffsets, moreCount, cutLine,
  viewQuery, viewParams, viewsOf, addView, removeView, activeView, VIEWS_MAX, undoOf, excludedWords, tagDone, smsDone, filterKey } from '../../web/src/ui/list-state.ts';

const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => 'c' + (from + i));

test('selection: off until « Sélectionner »; rows ticked one by one; leaving the mode forgets them', () => {
  assert.deepEqual([NONE.on, count(NONE)], [false, 0]);
  assert.equal(toggle(NONE, 'c1'), NONE, 'a tap on a row selects nothing while the mode is off');
  let s = start(NONE, 'k');
  assert.deepEqual([s.on, count(s)], [true, 0]);
  s = toggle(toggle(toggle(s, 'c1'), 'c2'), 'c3');
  assert.deepEqual([count(s), isSelected(s, 'c2'), isSelected(s, 'c9')], [3, true, false]);
  s = toggle(s, 'c2');
  assert.deepEqual([count(s), isSelected(s, 'c2')], [2, false]);
  assert.deepEqual(target(s, { q: '', segment: 'all' }), { ids: ['c1', 'c3'] });
  assert.deepEqual(stop(s), NONE);
  assert.deepEqual(count(clear(s)), 0);
  assert.equal(clear(s).on, true, 'cleared, still selecting');
});

test('« Tout sélectionner (N) » selects the filter, not the rows loaded: the server resolves it, the count is what was confirmed', () => {
  let s = start(NONE, 'q=&segment=vip');
  s = toggle(s, 'c1');
  // 214 files match, 60 are on screen: the ids are not kept, the filter is
  s = selectAll(s, { key: 'q=&segment=vip', total: 214, ids: ids(214), truncated: false, max: 2000 });
  assert.deepEqual([count(s), s.all && s.all.total, s.ids.length, s.capped], [214, 214, 0, 0]);
  assert.ok(isSelected(s, 'c5') && isSelected(s, 'c213') && isSelected(s, 'never-loaded'), 'every row of the filter, loaded or not');
  assert.deepEqual(target(s, { q: '', segment: 'vip' }), { filter: { segment: 'vip' }, expect: 214 });
  // unticking rows keeps the filter and names them
  s = toggle(toggle(s, 'c5'), 'c7');
  assert.deepEqual([count(s), isSelected(s, 'c5'), isSelected(s, 'c6')], [212, false, true]);
  assert.deepEqual(target(s, { q: 'da silva', segment: 'vip', sort: 'name' }), { filter: { q: 'da silva', segment: 'vip' }, except: ['c5', 'c7'], expect: 212 });
  s = toggle(s, 'c5');
  assert.equal(count(s), 213);
  // the list moved under it (someone booked): the count follows what the list says now, so the confirmation shows it
  s = syncTotal(s, 'q=&segment=vip', 215);
  assert.deepEqual([count(s), target(s, { segment: 'vip' }).expect], [214, 214]);
  assert.equal(syncTotal(s, 'another filter', 3), s, 'a total of another filter is ignored');
  assert.equal(syncTotal(toggle(start(NONE, 'k'), 'c1'), 'k', 9).all, null, 'rows ticked by hand have no total to follow');
});

test('a filter over the cap: the first 2 000 by ids, and it says so; « all » is never claimed', () => {
  let s = start(NONE, 'k');
  s = selectAll(s, { key: 'k', total: 5520, ids: ids(2000), truncated: true, max: 2000 });
  assert.deepEqual([s.all, count(s), s.capped], [null, 2000, 5520]);
  assert.equal(target(s, {}).ids.length, 2000);
  assert.ok(!('filter' in target(s, {})));
  assert.equal(toggle(s, 'c0').capped, 5520);
});

test('a selection never outlives its filter: another search, segment or view clears it', () => {
  let s = selectAll(start(NONE, 'a'), { key: 'a', total: 12, ids: ids(12), truncated: false, max: 2000 });
  assert.equal(forFilter(s, 'a'), s, 'same filter: untouched');
  const t = forFilter(s, 'b');
  assert.deepEqual([t.on, t.all, count(t), t.key], [true, null, 0, 'b']);
  assert.equal(forFilter(NONE, 'b'), NONE);
  // an answer to « Tout sélectionner » that arrives after the filter changed is dropped
  assert.equal(selectAll(t, { key: 'a', total: 12, ids: ids(12), truncated: false, max: 2000 }), t);
  // the sort is not part of what is selected
  assert.equal(filterKey({ q: ' Karim ', segment: 'all', sort: 'name' }), filterKey({ q: 'karim', segment: '', sort: 'spend' }));
  assert.notEqual(filterKey({ q: 'karim' }), filterKey({ q: 'karim', segment: 'vip' }));
});

test('pages: 60 rows each, by offset; the next page never asks for the ones before', () => {
  assert.equal(PAGE, 60);
  assert.deepEqual(pageOffsets(1), [0]);
  assert.deepEqual(pageOffsets(3), [0, 60, 120]);
  assert.deepEqual([moreCount(5520, 60), moreCount(100, 60), moreCount(60, 60), moreCount(0, 0)], [60, 40, 0, 0]);
  assert.equal(cutLine(5520, 120), '120 sur 5\u202f520');
  assert.equal(cutLine(48, 48), '');
});

test('saved views: a name and the query, 8 at most for the person, one per name and page; the query is canonical', () => {
  assert.equal(viewQuery({ q: ' Da Silva ', segment: 'vip', tri: 'name' }), 'q=Da+Silva&segment=vip&tri=name');
  assert.equal(viewQuery({ q: '', segment: 'all', tri: '' }), '', 'no filter: nothing to save');
  assert.equal(viewQuery({ tri: 'name', segment: 'relancer', junk: 'x' }), 'segment=relancer&tri=name', 'only the list’s own keys, in one order');
  assert.deepEqual(viewParams('q=Da+Silva&segment=vip&autre=1'), { q: 'Da Silva', segment: 'vip', tri: null });
  assert.deepEqual(viewParams(''), { q: null, segment: null, tri: null });
  assert.ok(viewQuery({ q: 'x'.repeat(300) }).length <= 200, 'never longer than the server stores');

  let views = [{ page: 'relances', name: 'Échecs', query: 'etat=echec' }];
  let r = addView(views, 'clients', '  VIP à relancer ', 'segment=vip');
  assert.equal(r.error, undefined);
  views = r.views;
  assert.deepEqual(viewsOf(views, 'clients'), [{ page: 'clients', name: 'VIP à relancer', query: 'segment=vip' }]);
  assert.equal(views.length, 2, 'the other pages’ views are kept');
  // the same name again replaces it
  views = addView(views, 'clients', 'VIP à relancer', 'segment=vip&tri=spend').views;
  assert.deepEqual(viewsOf(views, 'clients').map((v) => v.query), ['segment=vip&tri=spend']);
  assert.equal(activeView(views, 'clients', 'segment=vip&tri=spend').name, 'VIP à relancer');
  assert.equal(activeView(views, 'clients', 'segment=vip'), null);
  assert.equal(activeView(views, 'relances', 'segment=vip&tri=spend'), null);
  // refused, with the reason: no name, no filter, a name too long, the 9th view
  assert.match(addView(views, 'clients', '  ', 'segment=vip').error, /nom/i);
  assert.match(addView(views, 'clients', 'Tous', '').error, /filtre/i);
  assert.match(addView(views, 'clients', 'x'.repeat(31), 'segment=vip').error, /30/);
  let full = views;
  for (let i = 0; full.length < VIEWS_MAX; i++) full = addView(full, 'clients', 'Vue ' + i, 'q=' + i).views;
  assert.equal(full.length, 8);
  const ninth = addView(full, 'clients', 'Une de trop', 'q=z');
  assert.match(ninth.error, /8/);
  assert.equal(ninth.views, full, 'nothing changed');
  assert.equal(addView(full, 'clients', 'Vue 0', 'q=autre').error, undefined, 'replacing one is not a 9th');
  assert.deepEqual(removeView(views, 'clients', 'VIP à relancer'), [{ page: 'relances', name: 'Échecs', query: 'etat=echec' }]);
});

test('undo: a tag is undone by its inverse on the files that changed; a text or an export has no undo and says nothing else', () => {
  assert.deepEqual(undoOf({ op: 'tag', tag: 'VIP', changed: 2, ids: ['a', 'b'] }), { op: 'untag', tag: 'VIP', ids: ['a', 'b'] });
  assert.deepEqual(undoOf({ op: 'untag', tag: 'VIP', changed: 1, ids: ['a'] }), { op: 'tag', tag: 'VIP', ids: ['a'] });
  assert.equal(undoOf({ op: 'tag', tag: 'VIP', changed: 0, ids: [] }), null, 'nothing changed: nothing to undo');
  assert.equal(undoOf({ op: 'sms', sent: 12, ids: ['a'] }), null, 'a text that left cannot be taken back');
  assert.equal(undoOf({ op: 'export', ids: ['a'] }), null);
});

test('words: what was done, and who was left out, counted by reason', () => {
  assert.deepEqual(tagDone({ op: 'tag', tag: 'VIP', changed: 200, unchanged: 14, missing: 0, full: 0 }), { title: '« VIP » ajoutée à 200 fiches', sub: '14 l’avaient déjà' });
  assert.deepEqual(tagDone({ op: 'untag', tag: 'VIP', changed: 1, unchanged: 0, missing: 2, full: 0 }), { title: '« VIP » retirée de 1 fiche', sub: '2 fiches effacées ou fusionnées entre-temps' });
  assert.deepEqual(tagDone({ op: 'tag', tag: 'VIP', changed: 0, unchanged: 3, missing: 0, full: 1 }), { title: 'Aucune fiche à changer', sub: '3 l’avaient déjà · 1 a déjà 8 étiquettes' });
  assert.equal(excludedWords({ noConsent: 10, noPhone: 2, recent: 1, other: 0 }), '13 exclus : 10 sans accord pour les bons plans, 2 sans numéro ou SMS coupés, 1 venu il y a moins de 7 jours ou jamais');
  assert.equal(excludedWords({ noConsent: 0, noPhone: 0, recent: 0, other: 1 }), '1 exclu : 1 déjà relancé aujourd’hui ou numéro sans SMS');
  assert.equal(excludedWords({ noConsent: 0, noPhone: 0, recent: 0, other: 0 }), '');
  assert.deepEqual(smsDone({ sent: 17, excluded: { noConsent: 3, noPhone: 0, recent: 0, other: 0 } }), { title: '17 relances en route', sub: '3 exclus : 3 sans accord pour les bons plans' });
  assert.equal(smsDone({ sent: 1, excluded: { noConsent: 0, noPhone: 0, recent: 0, other: 0 } }).title, '1 relance en route');
  assert.equal(smsDone({ sent: 0, excluded: { noConsent: 2, noPhone: 0, recent: 0, other: 0 } }).title, 'Aucun SMS envoyé');
});
