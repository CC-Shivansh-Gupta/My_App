import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, stepsFor } from '../app/js/install.js';

const UA = {
  chromeIpad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  desktopModeIpad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

test('detects Chrome on iPad and points to the Share icon, not an install menu', () => {
  const env = detect(UA.chromeIpad, 5);
  assert.deepEqual(env, { ios: true, device: 'ipad', browser: 'chrome' });
  const steps = stepsFor(env).join(' ');
  assert.match(steps, /Share icon/);
  assert.match(steps, /Add to Home Screen/);
  assert.match(steps, /16\.4/);
});

test('an iPad in desktop mode is still treated as iPad', () => {
  assert.deepEqual(detect(UA.desktopModeIpad, 5), { ios: true, device: 'ipad', browser: 'safari' });
  assert.equal(detect(UA.desktopModeIpad, 0).ios, false); // a real Mac
  assert.match(stepsFor(detect(UA.desktopModeIpad, 5)).join(' '), /in Chrome it’s at the right end of the address bar/);
});

test('other platforms', () => {
  assert.equal(detect(UA.safariIphone, 5).device, 'iphone');
  assert.match(stepsFor(detect(UA.chromeAndroid, 5)).join(' '), /Install app/);
  assert.match(stepsFor(detect(UA.chromeMac, 0)).join(' '), /install icon/);
  assert.match(stepsFor(detect(UA.desktopModeIpad, 0)).join(' '), /Add to Dock/);
});
