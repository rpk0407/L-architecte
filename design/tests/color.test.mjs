// The contrast arithmetic, checked against values the WCAG itself publishes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { luminance, ratio, isLarge, required, parseColor, over, overPixels } from '../instruments/lib/color.mjs';

const L = (css) => luminance(parseColor(css));
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

test('black on white is 21:1 and a colour on itself is 1:1', () => {
  assert.ok(near(ratio(L('#000'), L('#fff')), 21, 0.001));
  assert.ok(near(ratio(L('#7a746c'), L('#7a746c')), 1, 0.0001));
  assert.equal(ratio(L('#000'), L('#fff')), ratio(L('#fff'), L('#000')), 'the order does not matter');
});

test('#767676 on white is the well-known 4.54:1 (the darkest grey that passes AA), #777 just fails', () => {
  assert.ok(near(ratio(L('#767676'), L('#fff')), 4.54), String(ratio(L('#767676'), L('#fff'))));
  assert.ok(ratio(L('#777777'), L('#fff')) < 4.5);
  assert.ok(near(ratio(L('#999'), L('#fff')), 2.85), '#999 on white is 2.85:1');
});

test('the shop’s own pairs: ink on the red button passes, white on the red does not', () => {
  assert.ok(ratio(L('#0F0E0D'), L('#EB4639')) >= 4.5, 'ink on red');
  assert.ok(ratio(L('#ffffff'), L('#EB4639')) < 4.5, 'white on red');
  assert.ok(ratio(L('#0F0E0D'), L('#ECE8E0')) > 15, 'ink on bone');
});

test('large text needs 3:1, everything else 4.5:1', () => {
  assert.equal(required(24), 3); assert.equal(required(18.66, 700), 3); assert.equal(required(18.66, 400), 4.5); assert.equal(required(16), 4.5);
  assert.ok(isLarge(24) && isLarge(19, 700) && !isLarge(18, 700) && !isLarge(23, 400));
});

test('parseColor reads hex and rgb()', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204, 1]);
  assert.deepEqual(parseColor('#0F0E0D'), [15, 14, 13, 1]);
  assert.deepEqual(parseColor('rgb(15, 14, 13)'), [15, 14, 13, 1]);
  assert.deepEqual(parseColor('rgba(15,14,13,.7)'), [15, 14, 13, 0.7]);
  assert.throws(() => parseColor('papayawhip'));
});

test('a translucent colour is composited before it is judged', () => {
  const eff = over([0, 0, 0, 0.5], [255, 255, 255]);
  assert.ok(near(eff[0], 127.5, 0.01));
});

test('over a photograph the worst pixel decides: light text fails on the lightest pixels, dark text on the darkest', () => {
  const light = overPixels([255, 255, 255, 1], { p05: 0.02, p50: 0.3, p95: 0.9 });
  assert.ok(light.worst < 1.3 && light.median > 2, 'white over a spread that reaches near-white');
  const dark = overPixels([0, 0, 0, 1], { p05: 0.0, p50: 0.7, p95: 0.95 });
  assert.ok(dark.worst < dark.median, 'the darkest pixel is the dark text’s worst case');
});
