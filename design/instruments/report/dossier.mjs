// The dossier: one self-contained page, drawn like an architect’s study sheet.
//
// Everything a run found, in the order a person decides in: the verdict, what to protect, what to fix, where two good things
// collide, who each finding is for, and how far to trust any of it. Images and fonts are embedded, so the file can be mailed,
// opened offline, or published as it is. Light and dark follow the reader’s system; the shop’s own tokens and typefaces are used.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, fontSource } from '../../../scripts/postbuild.mjs';
import { axisScores, jury, personaScores, severity, AXES } from '../lib/score.mjs';
import { PERSONAS } from '../../personas/index.mjs';
import { EVIDENCE } from '../../personas/schema.mjs';
import { MOMENTS } from '../../programme/moments.mjs';
import { TENSIONS } from '../../programme/tensions.mjs';

// French typography, once, for everything the page prints: no line may begin with » or : ? ! ; € % (the shop's own lexicon says so)
const fr = (s) => String(s ?? '').replace(/« /g, '«\u00A0').replace(/ »/g, '\u00A0»').replace(/ ([:;?!€%])/g, '\u00A0$1');
const esc = (s) => fr(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RANK = { blocker: 0, major: 1, minor: 2, note: 3 };
const SEV_FR = { blocker: 'Bloquant', major: 'Majeur', minor: 'Mineur', note: 'Note' };
const DOT = { pass: 'ok', warn: 'warn', fail: 'bad', info: 'info' };

function fonts() {
  const faces = FONTS.filter(([, f]) => /(sans-latin-(400|600)-normal|serif-latin-400-(normal|italic))/.test(f));
  return faces.map(([pkg, file]) => {
    const family = pkg === 'instrument-serif' ? 'Instrument Serif' : 'Instrument Sans';
    const style = file.includes('italic') ? 'italic' : 'normal';
    const weight = (file.match(/latin-(\d+)-/) || [])[1] || '400';
    try { return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(fontSource(pkg, file)).toString('base64')}) format('woff2')}`; } catch { return ''; }
  }).join('');
}

const CSS = `
:root{--bg:#ECE8E0;--sf:#F6F3EE;--tx:#0F0E0D;--tx2:#58534C;--ln:rgba(15,14,13,.14);--ln2:rgba(15,14,13,.34);--ac:#EB4639;--ok:#2B7A52;--warn:#9A6208;--bad:#C23A2F;--info:#7C766D;--chip:rgba(15,14,13,.06);--serif:'Instrument Serif','Times New Roman',Georgia,serif;--sans:'Instrument Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--pad:clamp(16px,5vw,56px);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F0E0D;--sf:#171513;--tx:#ECE8E0;--tx2:#ABA59C;--ln:rgba(236,232,224,.15);--ln2:rgba(236,232,224,.32);--ok:#6FD1A0;--warn:#E7B34F;--bad:#FF7A6E;--info:#9B958C;--chip:rgba(236,232,224,.07);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0F0E0D;--sf:#171513;--tx:#ECE8E0;--tx2:#ABA59C;--ln:rgba(236,232,224,.15);--ln2:rgba(236,232,224,.32);--ok:#6FD1A0;--warn:#E7B34F;--bad:#FF7A6E;--info:#9B958C;--chip:rgba(236,232,224,.07);color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--tx);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
a{color:inherit}
.w{max-width:1160px;margin:0 auto;padding:0 var(--pad)}
.k{font:600 11.5px/1.2 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tx2)}
h1,h2,h3{font-family:var(--serif);font-weight:400;margin:0;letter-spacing:-.01em;text-wrap:balance}
h1{font-size:clamp(46px,9vw,104px);line-height:.94}h1 em{color:var(--ac)}
h2{font-size:clamp(30px,4.4vw,46px);line-height:1.02}h3{font-size:24px;line-height:1.1}
.lede{max-width:44em;margin:22px 0 0;font:400 clamp(17px,1.8vw,20px)/1.5 var(--sans);color:var(--tx2)}
section{padding:clamp(40px,7vw,84px) 0;border-top:1px solid var(--ln2)}
.sh{display:flex;align-items:baseline;gap:16px;margin:0 0 26px;flex-wrap:wrap}.sh .n{font:italic 400 22px/1 var(--serif);color:var(--ac)}.sh p{margin:0;color:var(--tx2);max-width:46em}
.cart{display:grid;grid-template-columns:repeat(2,1fr);border:1px solid var(--ln2);margin:34px 0 0;background:var(--sf)}
.cart>div{padding:11px 14px;border-right:1px solid var(--ln);border-bottom:1px solid var(--ln)}.cart b{display:block;font:500 15px/1.25 var(--sans);margin-top:3px}
.top{padding-top:clamp(28px,5vw,56px);padding-bottom:clamp(8px,2vw,24px)}.mast{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
.mast .wm{font:italic 400 26px/1 var(--serif)}
.theme{font:600 12px/1 var(--sans);border:1px solid var(--ln2);background:transparent;color:var(--tx);padding:10px 14px;border-radius:99px;cursor:pointer;min-height:40px}
.beams{display:grid;gap:14px;max-width:880px}
.beam{display:grid;grid-template-columns:minmax(110px,150px) 1fr 64px;gap:14px;align-items:center}
.beam .l{font:500 15px/1.2 var(--sans)}.beam .l small{display:block;color:var(--tx2);font-weight:400;font-size:12.5px;margin-top:2px}
.bar{position:relative;height:12px;border-top:1px solid var(--ln2);border-bottom:1px solid var(--ln2)}
.bar i{position:absolute;left:0;top:0;bottom:0;background:var(--tx)}.bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 1px),var(--ln2) calc(10% - 1px) 10%)}
.bar.null i{display:none}.bar.null{border-style:dashed}
.val{font:400 30px/1 var(--serif);text-align:right}.val small{font:500 12px/1 var(--sans);color:var(--tx2)}
.tot{display:flex;gap:18px;align-items:baseline;margin:26px 0 0;flex-wrap:wrap}.tot .big{font:400 clamp(60px,9vw,96px)/.9 var(--serif)}.tot p{margin:0;color:var(--tx2);max-width:34em}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:clamp(28px,5vw,56px)}
.card{background:var(--sf);border:1px solid var(--ln);padding:18px 20px;border-radius:4px}
.res{display:grid;gap:14px}
.r{display:grid;grid-template-columns:64px 1fr;gap:6px 18px;background:var(--sf);border:1px solid var(--ln);border-left:4px solid var(--info);padding:18px 20px;border-radius:4px}
.r.blocker{border-left-color:var(--bad)}.r.major{border-left-color:var(--bad)}.r.minor{border-left-color:var(--warn)}
.r .no{font:italic 400 28px/1 var(--serif);color:var(--tx2)}.r h3{font:600 17px/1.3 var(--sans);letter-spacing:0}
.tag{display:inline-block;font:600 10.5px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;padding:5px 8px;border-radius:99px;background:var(--chip);color:var(--tx);margin:0 6px 6px 0}
.tag.blocker,.tag.major{background:var(--bad);color:#fff}.tag.minor{background:var(--warn);color:#fff}
:root[data-theme="dark"] .tag.blocker,:root[data-theme="dark"] .tag.major,:root[data-theme="dark"] .tag.minor{color:#0F0E0D}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .tag.blocker,:root:not([data-theme="light"]) .tag.major,:root:not([data-theme="light"]) .tag.minor{color:#0F0E0D}}
.why{font:italic 400 18px/1.35 var(--serif);color:var(--tx2);margin:8px 0}
.found{font-size:14.5px;color:var(--tx)}.found code,.mono{font:500 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tx2)}
.fix{margin:10px 0 0;padding:10px 12px;border:1px dashed var(--ln2);font-size:14px;border-radius:4px}.fix b{font:600 11px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--tx2);display:block;margin-bottom:4px}
.ev{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.ev figure{margin:0;width:150px}.ev img{display:block;width:100%;border:1px solid var(--ln2);border-radius:3px;background:var(--chip)}
.ev figcaption,.pl figcaption{font:500 11.5px/1.3 var(--sans);color:var(--tx2);margin-top:5px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;background:var(--info);vertical-align:1px}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}
.keep{columns:2 320px;column-gap:36px;margin:0;padding:0;list-style:none}.keep li{break-inside:avoid;padding:7px 0 7px 22px;border-top:1px solid var(--ln);position:relative;font-size:14.5px}.keep li::before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:700}
.tn{display:grid;gap:14px}.tn .sides{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}.tn .sides p{margin:0;padding:12px 14px;border:1px solid var(--ln);border-radius:4px;font-size:14.5px}
.ruling{border-left:3px solid var(--ac);padding:2px 0 2px 14px;margin:10px 0 0;font-size:15px}
.pers{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:16px}
.pc{background:var(--sf);border:1px solid var(--ln);padding:18px 20px;border-radius:4px;display:grid;gap:8px;align-content:start}
.pc .hd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.pc .q{font:italic 400 19px/1.3 var(--serif)}
.ring{width:58px;height:58px;flex:none}.ring text{font:400 20px var(--serif);fill:var(--tx)}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{font:500 11.5px/1 var(--sans);padding:6px 8px;border-radius:99px;background:var(--chip);color:var(--tx2)}
.film{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.film figure{margin:0}.film .fr{aspect-ratio:390/844;background:#111;border:1px solid var(--ln2);border-radius:4px;overflow:hidden;display:grid;place-items:center;color:#777;font:500 12px var(--sans)}.film img{width:100%;height:100%;object-fit:cover;display:block}
.pl{columns:3 230px;column-gap:14px}.pl figure{margin:0 0 14px;break-inside:avoid}.pl img{width:100%;display:block;border:1px solid var(--ln2);border-radius:3px}
.leg{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;padding:0;list-style:none;margin:14px 0}.leg li{padding:10px 12px;border:1px solid var(--ln);border-radius:4px;font-size:14px}
.lim li{margin:8px 0}.foot{padding:34px 0 60px;color:var(--tx2);font-size:13.5px;border-top:1px solid var(--ln2)}
@media (min-width:900px){.cart{grid-template-columns:repeat(4,1fr)}}
@media (max-width:640px){.beam{grid-template-columns:1fr 54px}.beam .bar{grid-column:1/-1;order:3}.tn .sides{grid-template-columns:1fr}.r{grid-template-columns:1fr}.r .no{font-size:22px}}
@media print{.theme{display:none}section{break-inside:avoid-page}}
`;

/**
 * @param {{ run: any, dir: string, panel?: any, gate?: any, fragment?: boolean }} o
 * fragment: just <title>, <style> and the content, for hosts that wrap the page themselves (a published Artifact); no theme button then, the host has one.
 */
export function renderDossier({ run, dir, panel = null, gate = null, fragment = false }) {
  const checks = run.checks;
  const axes = axisScores(checks);
  const j = jury(axes, panel);
  const ps = personaScores(checks, PERSONAS);
  const cache = new Map();
  const img = (file) => {
    if (!file) return '';
    if (!cache.has(file)) { const p = join(dir, file); cache.set(file, existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : ''); }
    return cache.get(file);
  };
  const evById = new Map(run.evidence.map((e) => [e.id, e]));
  const thumbs = (ids = [], n = 3) => ids.map((id) => evById.get(id)).filter((e) => e && e.kind === 'shot' && e.file).slice(0, n)
    .map((e) => `<figure><img src="${img(e.file)}" alt="${esc(e.label)}" loading="lazy"><figcaption>${esc(e.id)} · ${esc(e.label)}</figcaption></figure>`).join('');
  const pname = (id) => (PERSONAS.find((p) => p.id === id) || { archetype: id }).archetype;

  const date = new Date(run.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const measured = checks.filter((c) => c.status !== 'info');
  const n = (s) => measured.filter((c) => c.status === s).length;
  const reserves = checks.map((c) => ({ c, sev: severity(c) })).filter((x) => x.sev)
    .sort((a, b) => RANK[a.sev] - RANK[b.sev] || b.c.weight - a.c.weight || a.c.id.localeCompare(b.c.id));
  const kept = checks.filter((c) => c.protect && c.status === 'pass');
  const scored = Object.entries(ps.byPersona).filter(([, v]) => v.score != null && v.kind === 'client').sort((a, b) => a[1].score - b[1].score);
  const weakest = scored[0], strongest = scored[scored.length - 1];

  const beam = (label, sub, v, note) => `<div class="beam"><div class="l">${esc(label)}<small>${esc(sub)}</small></div><div class="bar${v == null ? ' null' : ''}"><i style="width:${v == null ? 0 : v * 10}%"></i></div><div class="val">${v == null ? '–' : v.toFixed(1)}<small>${v == null ? '' : ' /10'}</small></div></div>${note ? `<p class="mono" style="margin:-6px 0 4px 0">${esc(note)}</p>` : ''}`;
  const axisRows = Object.entries(j.axes).map(([k, a]) => beam(`${a.fr}${a.weight ? ` · ${Math.round(a.weight * 100)}` : ' · piste à part'}`, a.basis, a.final, panel && panel.axes && panel.axes[k] ? panel.axes[k].rationale : (a.instruments != null && a.counts.n ? `${a.counts.pass} pass · ${a.counts.warn} warn · ${a.counts.fail} fail` : ''))).join('');
  const personaRows = PERSONAS.filter((p) => p.kind === 'client').map((p) => { const s = ps.byPersona[p.id]; return beam(p.archetype, `weight ${Math.round(p.weight * 100)}% · ${s.n} checks`, s.score); }).join('');
  const staffRows = PERSONAS.filter((p) => p.kind === 'staff').map((p) => { const s = ps.byPersona[p.id]; return beam(p.archetype, `weight ${Math.round(p.weight * 100)}% · ${s.n} checks`, s.score); }).join('');

  const reserveHtml = reserves.map(({ c, sev }, i) => `<article class="r ${sev}" id="${esc(c.id)}"><div class="no">R-${String(i + 1).padStart(2, '0')}</div><div>
    <span class="tag ${sev}">${SEV_FR[sev]}</span><span class="tag">${esc(c.status)}</span>${c.decision ? '<span class="tag">décision</span>' : ''}${(c.personas || []).slice(0, 4).map((p) => `<span class="tag">${esc(pname(p))}</span>`).join('')}
    <h3>${esc(c.title)}</h3>
    ${c.why ? `<p class="why">${esc(c.why)}</p>` : ''}
    <p class="found"><b>${esc(c.value ?? '')}</b> ${esc(c.unit ?? '')}${c.threshold ? ` <span class="mono">· attendu : ${esc(c.threshold)}</span>` : ''}${c.detail ? `<br><span class="mono">${esc(c.detail)}</span>` : ''}</p>
    ${c.fix ? `<div class="fix"><b>Remède le moins cher</b>${esc(c.fix)}</div>` : ''}
    <div class="ev">${thumbs(c.evidence)}</div><p class="mono" style="margin:10px 0 0">${esc(c.id)}</p></div></article>`).join('');

  const keepHtml = kept.map((c) => `<li>${esc(c.title)}</li>`).join('');

  const tensionHtml = TENSIONS.map((t) => `<article class="card"><div class="k">${esc(t.id)} · ${esc(t.en)}${t.ownerDecision ? ' · à décider' : ''}</div><h3 style="margin-top:6px">${esc(t.fr)}</h3>
    <div class="sides"><p>${esc(t.sides[0])}</p><p>${esc(t.sides[1])}</p></div><p style="margin:0 0 8px;font-size:15px">${esc(t.story)}</p>
    <p class="mono" style="margin:0">${t.checks.length ? t.checks.map((id) => { const c = checks.find((x) => x.id === id); return `<span style="white-space:nowrap;margin-right:14px"><span class="dot ${c ? DOT[c.status] : ''}"></span>${esc(id)}${c ? '' : ' (non mesuré)'}</span>`; }).join(' ') : 'Jugé par le jury, non mesurable.'}</p>
    <p class="ruling"><b>Règle par défaut.</b> ${esc(t.ruling)}</p></article>`).join('');

  const ring = (v) => { const r = 24, c = 2 * Math.PI * r; return `<svg class="ring" viewBox="0 0 58 58" role="img" aria-label="score ${v == null ? 'n/a' : v}"><circle cx="29" cy="29" r="${r}" fill="none" stroke="var(--ln2)" stroke-width="3"/>${v == null ? '' : `<circle cx="29" cy="29" r="${r}" fill="none" stroke="var(--tx)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * v) / 10} ${c}" transform="rotate(-90 29 29)"/>`}<text x="29" y="35" text-anchor="middle">${v == null ? '–' : v.toFixed(1)}</text></svg>`; };
  const voice = (id) => (panel && panel.voices || []).find((v) => v.persona === id);
  const personaHtml = PERSONAS.map((p) => { const s = ps.byPersona[p.id]; const mine = reserves.filter((x) => (x.c.personas || []).includes(p.id)).length; const v = voice(p.id);
    const cls = p.evidence.reduce((a, e) => ({ ...a, [e.cls]: (a[e.cls] || 0) + 1 }), {});
    return `<article class="pc"><div class="hd"><div><div class="k">${esc(p.kind === 'client' ? 'Client' : 'Équipe')} · ${esc(p.priority)} · ${Math.round(p.weight * 100)}%</div><h3 style="margin-top:6px">${esc(p.archetype)}</h3><div class="mono">${esc(p.name)}, ${p.age} · ${esc(p.role)}</div></div>${ring(s.score)}</div>
      <p class="q">${esc(p.headline)}</p>${v ? `<p style="margin:0;font-size:14.5px"><b>Pense à voix haute :</b> ${esc(v.says)}${v.abandonsAt ? ` <i>Il abandonne ici : ${esc(v.abandonsAt)}</i>` : ''}</p>` : ''}
      <div class="chips">${p.scenes.map((sc) => `<span class="chip" title="${esc(sc.label)}">${esc(sc.clock)} · ${esc(sc.device)} · ${esc(sc.network)}${sc.scheme === 'dark' ? ' · sombre' : ''}</span>`).join('')}</div>
      <p style="margin:0;font-size:14px;color:var(--tx2)">${mine} réserve${mine === 1 ? '' : 's'} · ${s.pass || 0} ✓ · ${s.warn || 0} ~ · ${s.fail || 0} ✗</p>
      <p class="mono" style="margin:0">preuves : ${Object.entries(cls).map(([k, v2]) => `${k}×${v2}`).join(' · ')}</p></article>`; }).join('');

  const strip = run.evidence.filter((e) => e.trial === 'rue' && /^Filmstrip/.test(e.label));
  const filmHtml = strip.map((e) => `<figure><div class="fr">${e.file ? `<img src="${img(e.file)}" alt="${esc(e.label)}">` : 'rien encore à l’écran'}</div><figcaption>${esc(e.label.replace('Filmstrip ', ''))}</figcaption></figure>`).join('');
  const plates = run.evidence.filter((e) => e.kind === 'shot' && e.file && !strip.includes(e));
  const platesHtml = plates.map((e) => `<figure><img src="${img(e.file)}" alt="${esc(e.label)}" loading="lazy"><figcaption>${esc(e.id)} · ${esc(e.label)}</figcaption></figure>`).join('');

  const gateHtml = gate ? `<div class="card" style="margin-top:22px"><div class="k">Cliquet · ${gate.ok ? 'tenu' : 'rompu'}</div><p style="margin:8px 0 0">${gate.regressions.length} régression(s), ${gate.improvements.length} amélioration(s), ${gate.newFindings.length + gate.newBlockers.length} nouvelle(s) réserve(s) depuis la dernière réception.</p></div>` : '';
  const panelHtml = panel && panel.reserves && panel.reserves.length ? `<section><div class="w"><div class="sh"><span class="n">Planche 04b</span><h2>Réserves du jury</h2><p>Ce que les instruments ne mesurent pas: les jugements du directeur artistique, du rédacteur et des autres, chacun appuyé sur une preuve.</p></div><div class="res">${panel.reserves.map((r, i) => `<article class="r ${esc(r.severity || 'minor')}"><div class="no">J-${String(i + 1).padStart(2, '0')}</div><div><span class="tag ${esc(r.severity || '')}">${esc(r.severity || '')}</span><span class="tag">${esc(r.from || 'jury')}</span><h3>${esc(r.title)}</h3><p class="found">${esc(r.proposal || '')}</p><div class="ev">${thumbs(r.evidence)}</div><p class="mono">${esc((r.evidence || []).join(' · '))}</p></div></article>`).join('')}</div></div></section>` : '';

  const lensNote = panel && Array.isArray(panel.lenses) && panel.lenses.length < 8 ? ` The jury is partial: ${panel.lenses.join(', ')} only.` : '';
  const summary = `${measured.length} checks on ${run.trials.length} trials, driven as ${PERSONAS.length} personas through ${Object.keys(run.clocks).length} pinned moments: ${n('pass')} hold, ${n('warn')} waver, ${n('fail')} fail.${weakest && strongest ? ` Among the clientele the site serves ${pname(strongest[0])} best (${strongest[1].score}) and ${pname(weakest[0])} least (${weakest[1].score}).` : ''}${lensNote}`;

  const content = `
<div class="w top"><div class="mast"><span class="wm">L’Architecte · Le Cabinet</span>${fragment ? '' : `<button class="theme" type="button" onclick="(function(){var r=document.documentElement,d=r.getAttribute('data-theme')==='dark'||(!r.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme: dark)').matches);r.setAttribute('data-theme',d?'light':'dark')})()">Clair / sombre</button>`}</div>
<h1 style="margin-top:clamp(34px,7vw,80px)">Dossier <em>d’études.</em></h1>
<p class="lede">${esc(summary)}</p>
<div class="cart"><div><span class="k">Projet</span><b>Barber L’Architecte, Marseille 13e</b></div><div><span class="k">Dossier</span><b>Étude d’usage, instruments</b></div><div><span class="k">Révision</span><b>${esc(run.build)}</b></div><div><span class="k">Date</span><b>${esc(date)}</b></div><div><span class="k">Échelle</span><b>1 : 1 · 390 × 844 et autres</b></div><div><span class="k">Dessiné par</span><b>Le Cabinet · ${esc(run.runId)}</b></div><div><span class="k">Navigateur</span><b>${esc(run.chromium)}</b></div><div><span class="k">Jury</span><b>${panel ? (Array.isArray(panel.lenses) ? `${panel.lenses.length} regard${panel.lenses.length > 1 ? 's' : ''} sur 8` : esc(panel.date || 'rendu')) : 'en attente'}</b></div></div></div>

<section><div class="w"><div class="sh"><span class="n">Planche 01</span><h2>Verdict</h2><p>Deux lectures des mêmes vérifications: celle d’un jury (les quatre pondérations publiées par Awwwards, plus une piste Métier à part) et celle de la clientèle.</p></div>
<div class="two"><div><div class="k" style="margin-bottom:14px">Jury</div><div class="beams">${axisRows}</div><div class="tot"><span class="big">${j.total == null ? '–' : j.total.toFixed(1)}</span><p>${j.total == null ? 'Aucun axe jugé pour l’instant.' : j.partial ? `Total partiel, sur ${j.covers.join(', ')} seulement: il ne se compare pas à un total complet. Design, Créativité et Contenu attendent le jury.` : 'Total pondéré 40 · 30 · 20 · 10.'}</p></div></div>
<div><div class="k" style="margin-bottom:14px">Clientèle · ${ps.clients == null ? '–' : ps.clients.toFixed(1)} pondéré</div><div class="beams">${personaRows}</div><div class="k" style="margin:26px 0 14px">Équipe · ${ps.staff == null ? '–' : ps.staff.toFixed(1)} pondéré</div><div class="beams">${staffRows}</div></div></div>${gateHtml}</div></section>

<section><div class="w"><div class="sh"><span class="n">Planche 02</span><h2>Ce qu’on protège</h2><p>${kept.length} choses qui marchent et qu’aucune retouche ne doit abîmer. Sur un site déjà soigné, le risque principal est de casser ce qui est bon.</p></div><ul class="keep">${keepHtml}</ul></div></section>

<section><div class="w"><div class="sh"><span class="n">Planche 03</span><h2>Réserves</h2><p>${reserves.length} points à reprendre, du plus lourd au plus léger. Chacun dit pour qui ça compte, ce qui a été mesuré, et le remède le moins cher que le Cabinet connaisse.</p></div><div class="res">${reserveHtml}</div></div></section>
${panelHtml}
<section><div class="w"><div class="sh"><span class="n">Planche 04</span><h2>Tensions</h2><p>Là où deux bonnes choses tirent en sens inverse. Chacune porte une règle par défaut: une recommandation, jamais un verdict.</p></div><div class="tn">${tensionHtml}</div></div></section>

<section><div class="w"><div class="sh"><span class="n">Planche 05</span><h2>Les treize</h2><p>Les personas qui font tourner les épreuves. Leur poids est une hypothèse, à remplacer par ce que le journal du salon mesure.</p></div><div class="pers">${personaHtml}</div></div></section>

${filmHtml ? `<section><div class="w"><div class="sh"><span class="n">Planche 06</span><h2>Pellicule</h2><p>La première charge sur un signal faible, photographiée par Chrome au rythme où l’écran change vraiment: ce qu’un inconnu voit sur la place, à midi.</p></div><div class="film">${filmHtml}</div></div></section>` : ''}

<section><div class="w"><div class="sh"><span class="n">Planche 07</span><h2>Planches</h2><p>${plates.length} captures, chacune avec son identifiant de preuve. Le jury ne peut rien affirmer sans en citer au moins une.</p></div><div class="pl">${platesHtml}</div></div></section>

<section><div class="w"><div class="sh"><span class="n">Planche 08</span><h2>Méthode et limites</h2><p>Comment lire tout ce qui précède, et ce qu’il ne faut pas lui faire dire.</p></div>
<ul class="leg">${Object.entries(EVIDENCE).map(([k, v]) => `<li><b>${k}</b> · ${esc(v)}</li>`).join('')}</ul>
<ul class="lim"><li><b>Un laboratoire, pas un terrain.</b> Les épreuves tournent sur le salon de démonstration, sur une horloge fixée, dans Chromium, avec une latence et un processeur bridés. Les temps de chargement sont des majorants (le serveur local n’envoie rien de compressé) à comparer d’un passage à l’autre, jamais des promesses.</li>
<li><b>Les instruments mesurent, le jury juge.</b> Design, Créativité et Contenu ne sont pas mesurables par un script: ils restent vides tant que le jury n’a pas rendu (panel.json). Un total n’est imprimé que s’il couvre les quatre axes.</li>
<li><b>Les personas sont des hypothèses.</b> La recherche indépendante sur l’usage des barbiers est mince, et presque tout ce qui s’écrit est publié par des éditeurs de logiciels. Chaque affirmation porte sa classe de preuve; le poids de chaque persona attend les parts réelles du journal.</li>
<li><b>Ce qui n’est pas mesuré.</b> Le rendu sur un vrai iPhone ou un vrai Android, la lecture d’un lecteur d’écran, le clavier virtuel réel (émulé ici en raccourcissant la fenêtre), la durée de vie des minuteries, l’état de production (CDN, compression, données réelles).</li>
<li><b>Rejouer.</b> <span class="mono">npm run build &amp;&amp; npm run ux</span>, puis <span class="mono">npm run ux:gate</span> pour comparer à la dernière réception.</li></ul></div></section>

<div class="w foot">Généré par le Cabinet à partir de ${esc(run.runId)} · ${checks.length} vérifications, ${run.evidence.length} preuves · révision ${esc(run.build)}</div>
`;
  const css = `${fonts()}${CSS}`;
  if (fragment) return `<title>Dossier du Cabinet</title><style>${css}</style>
${content}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dossier du Cabinet</title><style>${css}</style></head><body>${content}</body></html>`;
}
