// CPT-03 · The guide steps of Réglages › Comptabilité point at parts that exist: every step's target is a data-guide
// attribute of the screen, ids are unique, every mark has its step, and the copy keeps to the rule (two sentences at
// most, « tu »). The section is listed in Réglages, behind the owner's capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import steps from '../../web/src/comptoir/guide/steps/CPT-03.ts';
import { SECTION_CAP } from '../../web/src/comptoir/pages/reglages/caps.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SOURCES = ['web/src/comptoir/pages/reglages/sections/Compta.tsx'];
const marks = () => SOURCES.flatMap((p) => [...read(p).matchAll(/data-guide="([^"]+)"/g)].map((m) => m[1]));

test('every step points at a data-guide part of Réglages › Comptabilité and reads as the guide asks', () => {
  const have = new Set(marks());
  assert.ok(steps.length >= 4);
  assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, 'ids are unique');
  for (const s of steps) {
    assert.ok(s.id && s.page && s.title && s.body, s.id);
    assert.equal(s.page, '/comptoir/reglages/compta', s.id);
    assert.ok(s.target && have.has(s.target), s.id + ': no data-guide="' + s.target + '" in ' + SOURCES.join(', '));
    assert.ok(s.body.split(/(?<=[.!?])\s+/).length <= 2, s.id + ': two sentences at most');
    assert.ok(!/\bvous\b|\bvotre\b|\bvos\b/i.test(s.title + ' ' + s.body), s.id + ': « tu », not « vous »');
    assert.deepEqual(s.roles, ['owner'], s.id + ': the owner’s screen');
  }
});

test('every data-guide mark of the screen has its step, and the section is the owner’s', () => {
  const targets = new Set(steps.map((s) => s.target));
  for (const m of marks()) assert.ok(targets.has(m), 'data-guide="' + m + '" has no step');
  assert.equal(SECTION_CAP.compta, 'settings');
  assert.match(read('web/src/comptoir/pages/Reglages.tsx'), /\{ id: 'compta', label: 'Comptabilité', hint: 'TVA, plan de comptes, ton comptable', icon: 'euro', group: 'Salon'/);
});
