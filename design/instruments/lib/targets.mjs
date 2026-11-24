// The verdict on a set of tap targets, the same everywhere (the public pages, the till, the keypad).
//   fail  a target under the 24 px floor that the spacing exception does not excuse, or three or more under 32 px
//   warn  something under the comfortable size (44 px, or the persona’s own, such as 56 px on a PIN keypad)
//   pass  nothing under it
export const sizeStatus = (under, small, below) => (below.length || small.length >= 3 ? 'fail' : under.length ? 'warn' : 'pass');

/** The smallest first, as “label 40×36 · label 44×40”. @param {{ d: string, w: number, h: number }[]} xs */
export const listTargets = (xs, n = 8) => xs.slice().sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h)).slice(0, n).map((x) => `${x.d} ${x.w}×${x.h}`).join(' · ');
