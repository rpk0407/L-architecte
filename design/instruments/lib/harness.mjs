// The harness: boots the real app on pinned clocks, opens a persona's scene in a real browser, and keeps the ledger.
//
//   server(clock)   one demo salon per pinned moment (LX_FAKE_NOW), booted lazily and reused
//   open(scene)     a browser context shaped by the scene: device, network, colour scheme, motion; the in-page library installed
//   check(c)        one verdict with its evidence; the score, the ratchet and the dossier all read these
//   shot / metric   evidence with a stable id (E-<trial>-<nn>) that the panel must cite
//
// Everything a trial claims goes through check(), so “what did the run say” is one array.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { playwright, startServer, requireBuild, ROOT } from '../../../tests/e2e/harness.mjs';
import { uxInpage } from './inpage.mjs';
import { DEVICES, NETWORKS, CLOCKS } from './surface.mjs';
import { PERSONAS, scenesFor } from '../../personas/index.mjs';

/** @typedef {'pass'|'warn'|'fail'|'info'} Status */
/**
 * @typedef {Object} Check
 * @property {string} id            stable across runs: it is what the ratchet remembers
 * @property {string} trial         the trial that made it
 * @property {string} title         what is being asked, in a human sentence
 * @property {string[]} [personas]  persona ids this check protects (traceability, and the persona view of the score)
 * @property {'usability'|'design'|'creativity'|'content'|'craft'} axis
 * @property {number} weight        1–5, how much it should move the axis
 * @property {Status} status
 * @property {number|string|boolean} [value]
 * @property {string} [unit]
 * @property {string} [threshold]
 * @property {string} [why]         the persona-voiced reason it matters
 * @property {string} [detail]      what was found
 * @property {string[]} [evidence]  evidence ids
 * @property {any} [data]           small structured detail for the dossier
 * @property {boolean} [protect]    when it passes, it goes on the “what we protect” list
 * @property {boolean} [decision]   a product decision, not a defect
 * @property {string} [fix]         the cheapest remedy the Cabinet can think of
 * @property {string} [scene]       the scene it was measured in
 */

export const OUT_ROOT = join(ROOT, '.lx-data', 'ux');

/** @param {string} s */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class Harness {
  /** @param {{ run?: string, only?: string[], persona?: string[] }} [o] */
  constructor(o = {}) {
    this.runId = o.run || new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    this.dir = join(OUT_ROOT, this.runId);
    this.only = o.only || [];
    this.personaFilter = o.persona || [];
    /** @type {Check[]} */ this.checks = [];
    /** @type {any[]} */ this.evidence = [];
    /** @type {any[]} */ this.trials = [];
    this.servers = new Map();
    this.trial = 'harness';
    this.counter = 0;
    this.trialErrors = [];
    this.thirdParty = new Set();
    this.pageLoads = 0;
  }

  async start() {
    requireBuild();
    mkdirSync(join(this.dir, 'shots'), { recursive: true });
    const { chromium } = playwright();
    this.browser = await chromium.launch();
    this.helper = await (await this.browser.newContext({ deviceScaleFactor: 1 })).newPage();
    await this.helper.setContent('<canvas></canvas>');
    return this;
  }

  async finish() {
    this.finalize();
    for (const s of this.servers.values()) await s.stop().catch(() => {});
    await this.browser.close().catch(() => {});
  }

  /** The demo salon on a pinned clock, booted once per distinct moment. */
  async server(clockId) {
    const clock = CLOCKS[clockId];
    if (!clock) throw new Error('unknown clock ' + clockId);
    if (!this.servers.has(clockId)) this.servers.set(clockId, await startServer({ LX_MODE: 'demo', LX_FAKE_NOW: clock.iso }, ['--memory']));
    return this.servers.get(clockId);
  }

  /** The scenes a trial runs: the personas’ own, narrowed by --persona. @param {string} trial */
  scenes(trial) {
    return scenesFor(trial).filter((s) => !this.personaFilter.length || this.personaFilter.includes(s.persona));
  }

  /**
   * Open a scene: a context shaped by the device, network, scheme and motion; throttling through the browser’s own protocol.
   * @param {{ clock: string, device: string, network?: string, scheme?: 'light'|'dark', motion?: 'reduce', id?: string, persona?: string }} scene
   * @param {{ device?: string, network?: string, javaScript?: boolean }} [over]
   */
  async open(scene, over = {}) {
    const server = await this.server(scene.clock);
    const dev = DEVICES[over.device || scene.device];
    let net = NETWORKS[over.network || scene.network || 'wifi'];
    const ctx = await this.browser.newContext({
      viewport: dev.viewport, deviceScaleFactor: 1, isMobile: dev.mobile, hasTouch: dev.mobile,
      locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme: scene.scheme || 'light',
      reducedMotion: scene.motion || 'no-preference', javaScriptEnabled: over.javaScript !== false
    });
    const page = await ctx.newPage();
    const errors = [];
    const origin = new URL(server.base).origin;
    page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); this.trialErrors.push(scene.id + ' · ' + e.message); });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|404 \(Not Found\)|Failed to load resource/.test(m.text())) { errors.push('console: ' + m.text()); this.trialErrors.push(scene.id + ' · ' + m.text()); }
    });
    page.on('request', (r) => {
      const u = r.url();
      if (/^(data|blob|about|chrome):/.test(u)) return;
      try { if (new URL(u).origin !== origin) this.thirdParty.add(new URL(u).host); } catch { /* ignore */ }
    });
    if (over.javaScript !== false) await page.addInitScript({ content: `(${uxInpage.toString()})()` });
    const cdp = await ctx.newCDPSession(page);
    if (net) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: net.cpu });
    }
    // what the load weighs on the wire: text is gzipped here (a CDN would do the same, better), pictures and fonts are as they are
    const loads = [];
    const isText = (ct) => /text|json|javascript|xml|svg/.test(ct || '');
    page.on('response', (r) => {
      if (/^(data|blob):/.test(r.url())) return;
      loads.push(r.body().then((b) => ({ url: r.url().replace(origin, ''), type: (r.headers()['content-type'] || '').split(';')[0], raw: b.length, wire: isText(r.headers()['content-type']) ? gzipSync(b).length : b.length })).catch(() => null));
    });
    const self = this;
    return {
      page, ctx, cdp, base: server.base, scene, errors, dev,
      /**
       * A true filmstrip: Chrome streams a timestamped frame at every visual change, so a throttled, busy page is not slowed by the
       * photographing of it (a screenshot under CPU throttling takes seconds and would make every label a lie).
       */
      async startFilm() {
        const frames = [];
        const onFrame = async (e) => {
          frames.push({ t: e.metadata.timestamp * 1000, data: e.data });
          try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch { /* the page is gone */ }
        };
        cdp.on('Page.screencastFrame', onFrame);
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
        const t0 = Date.now();
        return {
          t0,
          async stop() { await cdp.send('Page.stopScreencast').catch(() => {}); cdp.off('Page.screencastFrame', onFrame); },
          /** The frame on screen at `ms` after the start, or null when nothing had been painted yet. */
          pick(ms) { const ok = frames.filter((f) => f.t <= t0 + ms); return ok.length ? ok[ok.length - 1] : null; },
          /**
           * Milliseconds from the start to the first real paint. The stream opens with the blank page that was there before, so a frame
           * counts only once it is several times heavier than that one (a painted page is tens of kilobytes, an empty one a few).
           */
          firstPaint() {
            if (frames.length < 2) return null;
            const blank = frames[0].data.length;
            const real = frames.find((f) => f.data.length > blank * 4);
            return real ? Math.max(0, Math.round(real.t - t0)) : null;
          }
        };
      },
      /**
       * Cut the connection, or give it back. Playwright’s context.setOffline cannot be mixed with the throttling set here (the
       * booking “succeeds” while offline), so both go through the one protocol session; giving it back restores the scene’s network.
       */
      async offline(on) {
        await cdp.send('Network.emulateNetworkConditions', on
          ? { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
          : { offline: false, latency: net ? net.latency : 0, downloadThroughput: net ? net.down : -1, uploadThroughput: net ? net.up : -1 });
      },
      /** Change the network mid-session (set up on wifi, then go into the tunnel). */
      async throttle(name) {
        net = NETWORKS[name];
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net ? net.latency : 0, downloadThroughput: net ? net.down : -1, uploadThroughput: net ? net.up : -1 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: net ? net.cpu : 1 });
      },
      /** Bytes on the wire so far, compressed-equivalent, with the heaviest files first. */
      async weigh() {
        const all = (await Promise.all(loads)).filter(Boolean);
        return { files: all.length, raw: all.reduce((a, f) => a + f.raw, 0), wire: all.reduce((a, f) => a + f.wire, 0), top: all.slice().sort((a, b) => b.wire - a.wire).slice(0, 6) };
      },
      /** Go to a path and wait until the page has settled enough to be looked at. */
      async goto(path, o = {}) { self.pageLoads++; return page.goto(server.base + path, { waitUntil: o.waitUntil || 'load', timeout: 45000 }); },
      /** The in-page library, called by name: `await s.ux('targets', { min: 44 })`. */
      ux(name, arg) { return page.evaluate(([n, a]) => window.__ux[n](a), [name, arg]); },
      async close() { await ctx.close().catch(() => {}); }
    };
  }

  // ── evidence ─────────────────────────────────────────────────────────────────────────────────────────────────

  begin(trial) {
    this.trial = trial;
    this.counter = 0;
    this.trialErrors = [];
    this.t0 = Date.now();
  }

  /** Close a trial: one honest line about errors, whatever the trial found. */
  end(summary = {}) {
    const errs = [...new Set(this.trialErrors)];
    if (summary.scenesRun !== 0) {
      this.check({
        id: 'errors.' + this.trial, trial: this.trial, axis: 'craft', weight: 3, status: errs.length ? 'fail' : 'pass', protect: true,
        title: `No JavaScript or console error while the “${this.trial}” trial ran`,
        why: 'A script error is a dead button for someone, somewhere, on a phone nobody tested.',
        value: errs.length, unit: 'errors', detail: errs.slice(0, 3).join(' | ') || undefined, personas: summary.personas || []
      });
    }
    this.trials.push({ id: this.trial, ms: Date.now() - this.t0, checks: this.checks.filter((c) => c.trial === this.trial).length, ...summary });
  }

  /** @param {Check} c */
  check(c) {
    if (this.checks.some((x) => x.id === c.id)) c = { ...c, id: c.id + '~' + (this.checks.filter((x) => x.id.split('~')[0] === c.id).length + 1) };
    this.checks.push({ trial: this.trial, axis: 'usability', weight: 2, personas: [], evidence: [], ...c });
    return c.id;
  }

  /** A screenshot kept as evidence. Returns its id. @param {import('playwright').Page} page */
  async shot(page, label, o = {}) {
    const id = `E-${this.trial}-${String(++this.counter).padStart(2, '0')}`;
    const file = `shots/${id}-${slug(label).slice(0, 40)}.jpg`;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: !!o.fullPage, clip: o.clip, animations: 'disabled', timeout: 15000 });
      writeFileSync(join(this.dir, file), buf);
      const dim = o.clip || page.viewportSize() || {};
      this.evidence.push({ id, kind: 'shot', trial: this.trial, label, file, scene: o.scene, w: dim.width, h: dim.height, at: o.at });
    } catch (e) {
      this.evidence.push({ id, kind: 'shot', trial: this.trial, label, error: String(e.message).split('\n')[0], scene: o.scene });
    }
    return id;
  }

  /** A frame from a filmstrip kept as evidence (null frame: nothing was painted yet). Returns its id. */
  frame(frame, label, extra = {}) {
    const id = `E-${this.trial}-${String(++this.counter).padStart(2, '0')}`;
    if (!frame) { this.evidence.push({ id, kind: 'shot', trial: this.trial, label, blank: true, ...extra }); return id; }
    const file = `shots/${id}-${slug(label).slice(0, 40)}.jpg`;
    writeFileSync(join(this.dir, file), Buffer.from(frame.data, 'base64'));
    this.evidence.push({ id, kind: 'shot', trial: this.trial, label, file, ...extra });
    return id;
  }

  /** A measured number kept as evidence. Returns its id. */
  metric(label, value, unit, extra = {}) {
    const id = `E-${this.trial}-${String(++this.counter).padStart(2, '0')}`;
    this.evidence.push({ id, kind: 'metric', trial: this.trial, label, value, unit, ...extra });
    return id;
  }

  /** A piece of text kept as evidence (what the page said, word for word). */
  text(label, text, extra = {}) {
    const id = `E-${this.trial}-${String(++this.counter).padStart(2, '0')}`;
    this.evidence.push({ id, kind: 'text', trial: this.trial, label, text: String(text).slice(0, 600), ...extra });
    return id;
  }

  /** What only the whole run can say: privacy, across every page that was opened. */
  finalize() {
    if (!this.pageLoads || this.checks.some((c) => c.id === 'privacy.third-party')) return;
    const hosts = [...this.thirdParty];
    this.trial = 'privacy';
    this.check({
      id: 'privacy.third-party', trial: 'privacy', axis: 'craft', weight: 3, protect: true, status: hosts.length ? 'fail' : 'pass',
      title: 'No request leaves for a third party while pages load (fonts, analytics, widgets)',
      why: 'The shop self-hosts its fonts so that no visitor’s address reaches Google; a single widget undoes that promise.',
      value: hosts.length, unit: 'hosts', detail: hosts.length ? 'Requests to: ' + hosts.join(', ') : undefined,
      personas: ['passionne', 'nouveau'], data: hosts
    });
  }

  /** The run, ready for score.mjs and the dossier. */
  result() {
    let build = 'unknown';
    try { build = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
    return {
      version: 1, runId: this.runId, date: new Date().toISOString(), build,
      node: process.version, chromium: this.browser ? this.browser.version() : '',
      clocks: Object.fromEntries([...this.servers.keys()].map((k) => [k, CLOCKS[k].label])),
      personas: PERSONAS.map((p) => ({ id: p.id, kind: p.kind, weight: p.weight })),
      trials: this.trials, checks: this.checks, evidence: this.evidence
    };
  }

  save() {
    const r = this.result();
    writeFileSync(join(this.dir, 'run.json'), JSON.stringify(r, null, 1));
    mkdirSync(OUT_ROOT, { recursive: true });
    writeFileSync(join(OUT_ROOT, 'latest.json'), JSON.stringify({ runId: this.runId, dir: this.dir }));
    return r;
  }
}
