// The surface map: the one file that knows where things are in the product.
//
// Routes, selectors, devices, networks and pinned clocks live here and nowhere else. When the site's markup changes, this
// file is the only one to touch (the booking selectors are the same contract tests/e2e relies on). Everything else in the
// harness asks the surface, so a persona's scene is just names: { clock, device, network, scheme }.
import { DEMO } from '../../../server/domain/seed.js';

/** The product's public and staff surfaces. */
export const ROUTES = {
  home: '/',
  gift: '/carte-cadeau',
  training: '/formations',
  contact: '/contact',
  findBooking: '/mon-rendez-vous',
  cancelMember: '/resilier',
  legal: ['/mentions-legales', '/confidentialite', '/cgv'],
  comptoir: '/comptoir'
};

/** Public pages swept by the page-level trials (pouce, ancien, atelier). */
export const PUBLIC_PAGES = ['/', '/carte-cadeau', '/formations', '/contact', '/mon-rendez-vous', '/resilier', '/cgv', '/confidentialite', '/mentions-legales'];

/**
 * The booking sheet's stable contract (the selectors tests/e2e already depends on).
 * Steps: service → who → when → info → confirmation. Choosing a service, a barber or a slot advances by itself.
 */
export const SEL = {
  cta: '.cta .btn',
  nextSlot: '.hr-next',
  sheet: '.bk',
  sheetTitle: '#bk-t',
  stepLabel: '.bk-k',
  service: '.bk button.so',
  who: '.bk button.wh',
  fast: '.bk .fast',
  day: '.bk .dc',
  slot: '.bk button.sl',
  first: '#f-first',
  phone: '#f-phone',
  phoneHint: '#f-phone ~ span',
  confirm: '.bk-foot .btn',
  footer: '.bk-foot',
  deposit: '.bk .dep',
  hold: '.bk .hold, .bk [class*="hold"]',
  recap: '.bk .recap',
  rebook: '.bk .rb',
  close: '#bk-x',
  back: '.bk-top button[aria-label="Étape précédente"]',
  booked: '.ok-code b',
  alert: '.bk [role="alert"]'
};

/** Devices: viewports are CSS pixels. `mobile` turns on touch and the mobile viewport behaviour. */
export const DEVICES = {
  phone: { label: 'Phone 390×844 (iPhone 14 class)', viewport: { width: 390, height: 844 }, mobile: true },
  'phone-small': { label: 'Small Android 360×640', viewport: { width: 360, height: 640 }, mobile: true },
  'phone-tiny': { label: 'Reflow floor 320×568 (WCAG 1.4.10)', viewport: { width: 320, height: 568 }, mobile: true },
  'phone-keyboard': { label: 'Phone with the keyboard open 390×520', viewport: { width: 390, height: 520 }, mobile: true },
  tablet: { label: 'Tablet landscape 1180×820 (the till)', viewport: { width: 1180, height: 820 }, mobile: true },
  'tablet-portrait': { label: 'Tablet portrait 820×1180 (an iPad on the sofa)', viewport: { width: 820, height: 1180 }, mobile: true },
  laptop: { label: 'Laptop 1280×720', viewport: { width: 1280, height: 720 }, mobile: false },
  desktop: { label: 'Desktop 1440×900', viewport: { width: 1440, height: 900 }, mobile: false }
};

/**
 * Networks, the way Chrome DevTools names them (bytes per second; latency in ms), plus the metro tunnel.
 * `cpu` is the slowdown factor applied with them (4 is the mid-range phone Lighthouse assumes).
 */
export const NETWORKS = {
  wifi: null,
  '4g': { label: 'Fast 4G · 9 Mbps down · 150 ms', down: (9 * 1024 * 1024) / 8, up: (1.6 * 1024 * 1024) / 8, latency: 150, cpu: 2 },
  'slow-4g': { label: 'Slow 4G · 1.6 Mbps down · 150 ms', down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, latency: 150, cpu: 4 },
  metro: { label: 'Metro tunnel · 400 kbps · 400 ms', down: (400 * 1024) / 8, up: (200 * 1024) / 8, latency: 400, cpu: 4 }
};

/**
 * Pinned clocks. LX_FAKE_NOW makes the demo salon believe it is this moment (ignored in production), so a persona's
 * scene can happen on a closed Tuesday night or at the Saturday rush. One server is booted per distinct clock.
 * 2026-10-25 ended daylight saving: every date here is +01:00.
 */
export const CLOCKS = {
  'mar-15h10': { iso: '2026-10-27T15:10:00+01:00', label: 'Tuesday 15:10 · a busy afternoon (the demo salon\'s own clock)' },
  'mar-23h12': { iso: '2026-10-27T23:12:00+01:00', label: 'Tuesday 23:12 · the shop is closed, a thumb is awake' },
  'mer-18h05': { iso: '2026-10-28T18:05:00+01:00', label: 'Wednesday 18:05 · on the tram home' },
  'ven-17h00': { iso: '2026-10-30T17:00:00+01:00', label: 'Friday 17:00 · the weekend starts' },
  'sam-09h40': { iso: '2026-10-31T09:40:00+01:00', label: 'Saturday 09:40 · the opening rush' },
  'sam-12h40': { iso: '2026-10-31T12:40:00+01:00', label: 'Saturday 12:40 · lunch, standing in the square' },
  'dim-20h30': { iso: '2026-11-01T20:30:00+01:00', label: 'Sunday 20:30 · closed, someone plans the week' },
  'lun-21h00': { iso: '2026-10-26T21:00:00+01:00', label: 'Monday 21:00 · closed, the wedding is Saturday' }
};

/** Demo-only chrome the harness must not judge: the banner and the card that say it is a demo (web/src/comptoir/shell.css). */
export const DEMO_CHROME = ['.demo-band', '.demo-card', '.bk .demo'];

/** The staff side: demo credentials come from the seed itself, never typed here. */
export const STAFF = {
  owner: { email: DEMO.email, password: DEMO.password, pin: DEMO.ownerPin },
  /** a barber signs in on a salon device: tap a name, type a PIN */
  barber: { team: 'JKut', pin: DEMO.pins.JKut }
};

/** The money people read: euros in French typography (20 €, 1 234,50 €). */
export const EURO = /\d[\d\s  .,]*\s?€/;
