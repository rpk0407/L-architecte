#!/usr/bin/env node
// The Cabinet’s command line.
//
//   run        [--only=pouce,rue] [--persona=presse] [--run=name] [--no-report]   drive the trials against the built app, then draw the dossier
//   score      [--run=name] [--panel=path]                                         the score tables of a run
//   report     [--run=name] [--panel=path] [--fragment]                            draw the dossier (one self-contained HTML page; --fragment also writes the form a host can wrap)
//   gate       [--run=name] [--update]                                             compare a run with design/baseline.json; --update accepts it
//   atlas      [--check]                                                           write (or check) the generated programme files
//   calibrate                                                                      prove each instrument tells a good page from a bad one
//   list                                                                           the trials, the personas and their scenes
//
// Needs `npm run build` first for run (the trials drive the real built app on pinned clocks). Outputs go to .lx-data/ux/<run>/.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Harness, OUT_ROOT } from './lib/harness.mjs';
import { PERSONAS, allScenes } from '../personas/index.mjs';
import { TRIALS } from '../personas/schema.mjs';
import { axisScores, personaScores, jury } from './lib/score.mjs';
import { snapshot, compare } from './lib/ratchet.mjs';
import { renderDossier } from './report/dossier.mjs';
import { writeAtlas } from '../personas/atlas.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const BASELINE = join(ROOT, 'design', 'baseline.json');
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'run';
const opt = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3).split(',').filter(Boolean) : []; };
const flag = (name) => args.includes('--' + name);

const ORDER = ['rue', 'pouce', 'chrono', 'clavier', 'tram', 'retour', 'nuit', 'ancien', 'guichet', 'mains', 'atelier', 'duo'];
const ICON = { pass: '✓', warn: '~', fail: '✗', info: '·' };

async function loadTrial(id) {
  try { return await import(`./trials/${id}.mjs`); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(`trials/${id}.mjs`)) return null; throw e; }
}

/** The run to read: --run=name, or the latest. */
function readRun() {
  let dir;
  const named = opt('run')[0];
  if (named) dir = join(OUT_ROOT, named);
  else if (existsSync(join(OUT_ROOT, 'latest.json'))) dir = JSON.parse(readFileSync(join(OUT_ROOT, 'latest.json'), 'utf8')).dir;
  if (!dir || !existsSync(join(dir, 'run.json'))) { console.error('No run found. Run `npm run ux` first (after `npm run build`).'); process.exit(2); }
  return { dir, run: JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) };
}
function readPanel(dir) {
  const p = opt('panel')[0] || [join(dir, 'panel.json'), join(ROOT, 'design', 'panel.json')].find(existsSync);
  return p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
const readBaseline = () => (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null);

function tables(run, panel) {
  const axes = axisScores(run.checks);
  const ps = personaScores(run.checks, PERSONAS);
  return { axes, ps, j: jury(axes, panel) };
}

function printScore(run, panel) {
  const { j, ps } = tables(run, panel);
  const bar = (v) => (v == null ? '··········' : '█'.repeat(Math.round(v)) + '░'.repeat(10 - Math.round(v)));
  console.log('\n  Jury');
  for (const a of Object.values(j.axes)) console.log(`    ${a.fr.padEnd(11)} ${bar(a.final)} ${a.final == null ? '  –  ' : a.final.toFixed(1).padStart(4) + ' '} ${a.basis}`);
  console.log(`    ${'Total'.padEnd(11)} ${j.total == null ? '–' : j.total.toFixed(1)}${j.partial ? `  (partial: ${j.covers.join(', ') || 'nothing yet'} only)` : ''}`);
  console.log(`\n  Clientele ${ps.clients ?? '–'} · Staff ${ps.staff ?? '–'}  (weighted by who they are)`);
  for (const p of PERSONAS) { const s = ps.byPersona[p.id]; console.log(`    ${p.archetype.padEnd(24)} ${bar(s.score)} ${s.score == null ? '  –  ' : s.score.toFixed(1).padStart(4) + ' '} ${s.pass}✓ ${s.warn}~ ${s.fail}✗`); }
}

function report({ dir, run }, gate) {
  const panel = readPanel(dir);
  const html = renderDossier({ run, dir, panel, gate });
  const out = join(dir, 'dossier.html');
  writeFileSync(out, html);
  console.log(`  dossier → ${out.replace(ROOT + '/', '')}  (${(html.length / 1024 / 1024).toFixed(1)} MB, self-contained)`);
  if (flag('fragment')) {
    const frag = join(dir, 'dossier.fragment.html');
    writeFileSync(frag, renderDossier({ run, dir, panel, gate, fragment: true }));
    console.log(`  fragment → ${frag.replace(ROOT + '/', '')}  (for a host that wraps the page itself, such as a published Artifact)`);
  }
  return out;
}

async function run() {
  const only = opt('only');
  const want = ORDER.filter((id) => !only.length || only.includes(id));
  const bad = only.filter((o) => !TRIALS.includes(o));
  if (bad.length) { console.error('unknown trial: ' + bad.join(', ') + ' (known: ' + TRIALS.join(', ') + ')'); process.exit(2); }
  const h = await new Harness({ only, persona: opt('persona'), run: opt('run')[0] }).start();
  console.log(`\nLe Cabinet · run ${h.runId}\n`);
  let saved;
  try {
    for (const id of want) {
      const mod = await loadTrial(id);
      if (!mod) { console.log(`  – ${id.padEnd(8)} not written yet`); continue; }
      h.begin(id);
      let summary = {};
      try { summary = (await mod.run(h)) || {}; }
      catch (e) {
        h.check({ id: `${id}.crashed`, axis: 'craft', weight: 5, status: 'fail', title: `The “${id}” trial could not finish: a problem in the harness, not a verdict on the product`, detail: String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' ⏎ '), personas: [] });
      }
      h.end(summary);
      const mine = h.checks.filter((c) => c.trial === id);
      const n = (s) => mine.filter((c) => c.status === s).length;
      console.log(`  ${id.padEnd(8)} ${String(n('pass')).padStart(3)} pass  ${String(n('warn')).padStart(3)} warn  ${String(n('fail')).padStart(3)} fail  ${String(n('info')).padStart(3)} info   ${((Date.now() - h.t0) / 1000) | 0}s`);
      if (!flag('quiet')) for (const c of mine.filter((x) => x.status === 'fail' || x.status === 'warn')) console.log(`      ${ICON[c.status]} ${c.title}${c.detail ? '\n          ' + c.detail.slice(0, 160) : ''}`);
    }
  } finally {
    saved = h.save();
    await h.finish();
  }
  console.log(`\n  ${saved.checks.length} checks, ${saved.evidence.length} pieces of evidence → .lx-data/ux/${h.runId}/run.json`);
  printScore(saved, null);
  if (!flag('no-report')) { console.log(''); report({ dir: h.dir, run: saved }, null); }
  console.log('');
}

function gate() {
  const r = readRun();
  const { axes, ps } = tables(r.run, null);
  if (flag('update')) {
    writeFileSync(BASELINE, JSON.stringify(snapshot(r.run, axes, ps), null, 1) + '\n');
    console.log(`\n  baseline accepted: ${Object.keys(snapshot(r.run, axes, ps).checks).length} checks from run ${r.run.runId} (build ${r.run.build}) → design/baseline.json\n`);
    return;
  }
  const base = readBaseline();
  if (!base) { console.log('\n  No design/baseline.json yet. Accept this run with: npm run ux:gate -- --update\n'); return; }
  const g = compare(base, r.run, axes, ps);
  const line = (x) => `      ${x.id}  ${x.was || ''}${x.was ? ' → ' : ''}${x.now || x.status}  ${x.title || ''}`;
  console.log(`\n  Gate against the baseline of build ${base.build} (${base.date.slice(0, 10)}): ${g.ok ? 'HELD' : 'BROKEN'}`);
  if (g.regressions.length) console.log('\n  Regressions\n' + g.regressions.map(line).join('\n'));
  if (g.newBlockers.length) console.log('\n  New blockers\n' + g.newBlockers.map(line).join('\n'));
  if (g.axisDrops.length) console.log('\n  Axis scores that fell\n' + g.axisDrops.map((d) => `      ${d.axis}  ${d.was} → ${d.now}`).join('\n'));
  if (g.personaDrops.length) console.log('\n  Persona scores that fell\n' + g.personaDrops.map((d) => `      ${d.persona}  ${d.was} → ${d.now}`).join('\n'));
  if (g.improvements.length) console.log('\n  Improved\n' + g.improvements.map(line).join('\n'));
  if (g.newFindings.length) console.log('\n  New findings (not gated)\n' + g.newFindings.map(line).join('\n'));
  if (g.dropped.length) console.log('\n  In the baseline but not in this run: ' + g.dropped.join(', '));
  console.log('');
  if (!g.ok) process.exit(1);
}

function list() {
  console.log('\nTrials: ' + TRIALS.join(', '));
  console.log(`\n${PERSONAS.length} personas, ${allScenes().length} scenes:\n`);
  for (const p of PERSONAS) {
    console.log(`  ${p.archetype.padEnd(24)} ${p.kind === 'client' ? 'client' : 'staff '}  weight ${p.weight}`);
    for (const s of p.scenes) console.log(`      ${s.id.padEnd(20)} ${s.clock} · ${s.device} · ${s.network} · ${s.scheme} → ${s.trials.join(', ')}`);
  }
  console.log('');
}

switch (cmd) {
  case 'run': await run(); break;
  case 'list': list(); break;
  case 'score': { const r = readRun(); printScore(r.run, readPanel(r.dir)); console.log(''); break; }
  case 'report': { const r = readRun(); const base = readBaseline(); const { axes, ps } = tables(r.run, null); report(r, base ? compare(base, r.run, axes, ps) : null); break; }
  case 'gate': gate(); break;
  case 'atlas': {
    const stale = writeAtlas({ check: flag('check') });
    if (flag('check')) { if (stale.length) { console.error('out of date: ' + stale.join(', ') + '\nRun: npm run ux:atlas'); process.exit(1); } console.log('atlas is up to date'); }
    else console.log(stale.length ? 'written: ' + stale.join(', ') : 'atlas already up to date');
    break;
  }
  case 'calibrate': { const { calibrate } = await import('./calibrate.mjs'); process.exit(await calibrate()); }
  default: console.error('unknown command: ' + cmd); process.exit(2);
}
