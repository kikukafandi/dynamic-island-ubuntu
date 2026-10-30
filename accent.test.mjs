// Run: node accent.test.mjs
import assert from 'node:assert';
import {accentFromPixels} from './accent.js';

const fill = (rgb, n) => new Uint8Array(Array.from({length: n}, () => rgb).flat());

// A mostly-black cover with some red: the red wins, and comes out bright
const [r, g, b] = accentFromPixels(new Uint8Array([...fill([10, 10, 10], 90), ...fill([200, 30, 30], 10)]), 3);
assert(r > 200 && g < 120 && b < 120, `expected bright red, got ${[r, g, b]}`);

// Pure greyscale art has no accent
assert.strictEqual(accentFromPixels(fill([128, 128, 128], 50), 3), null);

// RGBA input is read with the right stride
const [r2, g2, b2] = accentFromPixels(new Uint8Array(fill([20, 60, 220, 255], 20)), 4);
assert(b2 > r2 && b2 > g2, `expected blue, got ${[r2, g2, b2]}`);

console.log('accent ok');
