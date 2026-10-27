// FID-03 · The guide steps of the loyalty screens point at parts that exist: every step's target is a data-guide attribute
// of a source file of the package, ids are unique, and the copy keeps to the rule (two sentences at most, « tu »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import comptoir from '../../web/src/comptoir/guide/steps/FID-03.ts';
import moi from '../../web/src/moi/guide/steps/FID-03.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SOURCES = {
  comptoir: ['web/src/comptoir/pages/reglages/sections/Fidelite.tsx', 'web/src/comptoir/pages/caisse/RewardChip.tsx', 'web/src/comptoir/pages/clients/LoyaltyCard.tsx'],
  moi: ['web/src/moi/avantages/Loyalty.tsx', 'web/src/moi/cards/LoyaltyOptOut.tsx']
};

for (const [name, steps] of Object.entries({ comptoir, moi })) {
  test(name + ': every step points at a data-guide part of the package and reads as the guide asks', () => {
    const marks = new Set(SOURCES[name].flatMap((p) => [...read(p).matchAll(/data-guide="([^"]+)"/g)].map((m) => m[1])));
    assert.ok(steps.length >= 2);
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, 'ids are unique');
    for (const s of steps) {
      assert.ok(s.id && s.page && s.title && s.body, s.id);
      assert.ok(name === 'moi' ? s.page.startsWith('/moi') : s.page.startsWith('/comptoir/'), s.id + ': page ' + s.page);
      if (s.target) assert.ok(marks.has(s.target), s.id + ': no data-guide="' + s.target + '" in ' + SOURCES[name].join(', '));
      assert.ok(s.body.split(/(?<=[.!?])\s+/).length <= 2, s.id + ': two sentences at most');
      assert.ok(!/\bvous\b|\bvotre\b|\bvos\b/i.test(s.title + ' ' + s.body), s.id + ': « tu », not « vous »');
    }
  });
}

test('every data-guide mark of the package has its step (nothing marked and left unexplained)', () => {
  for (const [name, steps] of Object.entries({ comptoir, moi })) {
    const targets = new Set(steps.map((s) => s.target));
    for (const p of SOURCES[name]) for (const m of read(p).matchAll(/data-guide="([^"]+)"/g)) assert.ok(targets.has(m[1]), p + ': data-guide="' + m[1] + '" has no step');
  }
});
