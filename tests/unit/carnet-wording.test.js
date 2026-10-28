// « Abonnement » is the monthly membership only; the prepaid pack is a « Carnet » (the data keeps saying `pack`). Nothing a
// person reads, in the Comptoir or on the public pages, may call the pack an abonnement: no « Abonnement 5 coupes », and no
// « abonnement » within 40 characters of « carnet », « pack » or « 5 coupes » in the same clause, unless the two are named
// side by side as different things (« coupes de carnet et d’abonnement », « Abonnement &amp; carnet »). Only what is shown is read: string literals and text between tags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = [...walk(join(ROOT, 'web/src')), ...walk(join(ROOT, 'public'))].filter((f) => /\.(tsx?|jsx?|html)$/.test(f) && !/\.d\.ts$/.test(f));


/** the words next to each other on purpose: two different things named together */
const BOTH = /carnets?(?:\s+de\s+coupes)?\s*(?:,|\/|&amp;|&|et|ou|ni)\s*(?:[^,.;:]{1,30}(?:,|et|ou)\s*)?(?:à l[’']|à |au |d[’']|de l[’']|l[’']|des |les |le |un |une )?abonnements?|abonnements?\s*(?:,|\/|&amp;|&|et|ou|ni)\s*(?:[^,.;:]{1,30}(?:,|et|ou)\s*)?(?:de |du |des |les |le |un |une |d[’']|au |à )?(?:carnets?|packs?)/gi;
// a branch taken when the pack is there (hasPack ? '…abonnement…', consumed ? '…'), or the old site's 5-cut pack that Mise en route
// counts, is the carnet and may not say abonnement
const PACKISH = /\b(?:hasPack|consumed|packId|\.pack)\s*\?\s*['"`][^'"`]*abonnement/i;
const OLDSITE = /abonnements?\s+de l[’']ancien site/i;
// within one clause: « … un carnet ou une carte cadeau sera perdu. Un abonnement … » names two things, not one
const NEAR = /abonnement[^.,;]{0,40}(?:carnet|pack|5 coupes)|(?:carnet|pack|5 coupes)[^.,;]{0,40}abonnement/is;

/** what a person can read in a line: string literals, and the text between a `>` and a `<` */
function shown(line) {
  const out = [];
  for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of line.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  // JSX text that runs to the end of its line
  const tail = line.match(/>([^<>{}]+)$/); if (tail) out.push(tail[1]);
  const head = line.match(/^\s*([^<>{}'"`=]+)</); if (head) out.push(head[1]);
  return out;
}

test('no « Abonnement 5 coupes », and no abonnement named beside a carnet as if it were one', () => {
  const bad = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) return;
      for (const seg of shown(line)) {
        // an id (« site-abonnement-carnet », « site.abonnement.carnet ») is never read by a person
        if (/^[\w.-]+$/.test(seg.trim())) continue;
        if (/abonnement 5 coupes/i.test(seg)) bad.push(rel + ':' + (i + 1) + '  ' + seg.trim().slice(0, 100));
        else if (NEAR.test(seg.replace(BOTH, ' '))) bad.push(rel + ':' + (i + 1) + '  ' + seg.trim().slice(0, 100));
        else if (/abonnement/i.test(seg.replace(BOTH, ' ')) && (PACKISH.test(line) || OLDSITE.test(seg))) bad.push(rel + ':' + (i + 1) + '  ' + seg.trim().slice(0, 100));
      }
    });
  }
  assert.deepEqual(bad, [], 'the pack is a « Carnet », the monthly membership an « Abonnement »:\n' + bad.join('\n'));
});

test('a line that reads the pack in code may not say abonnement', () => {
  const hit = (line) => shown(line).some((seg) => /abonnement/i.test(seg.replace(BOTH, ' ')) && (PACKISH.test(line) || OLDSITE.test(seg)));
  assert.ok(hit("hasPack ? ', hors abonnement (coche sa ligne)' : ''"));
  assert.ok(hit("plan?.consumed ? ', hors coupes d’abonnement déjà faites' : ''"));
  assert.ok(hit("'cartes cadeaux et abonnements de l’ancien site'"));
  assert.ok(!hit("hasPack ? ', hors carnet (coche sa ligne)' : ''"));
});

test('the wording check itself catches what it should', () => {
  const hit = (s) => /abonnement 5 coupes/i.test(s) || NEAR.test(s.replace(BOTH, ' '));
  for (const s of ['Abonnement 5 coupes', 'Reprendre un abonnement de 5 coupes', 'Ton abonnement carnet', 'Ce pack d’abonnement', 'abonnement : 5 coupes à utiliser']) assert.ok(hit(s), s);
  for (const s of ['Coupes de carnet et d’abonnement', 'Carnet/abonnement', 'Carnets et abonnements vendus', 'Ton abonnement Essentiel', 'Reprendre un carnet en cours']) assert.ok(!hit(s), s);
});
