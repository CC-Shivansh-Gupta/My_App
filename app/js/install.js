// Install help: works out which "add to home screen" steps apply to this device and browser.
// iOS/iPadOS never fire `beforeinstallprompt`, so there the only route is the Share sheet.

let deferredPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; });
}

// The browser offered a native install prompt (Chrome/Edge on Android and desktop).
export function canPrompt() { return !!deferredPrompt; }

export async function prompt() {
  if (!deferredPrompt) return false;
  const e = deferredPrompt;
  deferredPrompt = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

export function isInstalled() {
  if (typeof window === 'undefined') return false;
  return window.navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
}

// `ua` and `touchPoints` are passed in so this can be tested without a browser.
export function detect(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  // iPadOS asks for desktop sites by default, so an iPad can look like a Mac. Macs have no touch screen.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const device = !ios ? (/Android/.test(ua) ? 'android' : 'desktop')
    : /iPhone|iPod/.test(ua) ? 'iphone' : 'ipad';
  const browser = /CriOS/.test(ua) ? 'chrome' : /EdgiOS|Edg\//.test(ua) ? 'edge' : /FxiOS|Firefox\//.test(ua) ? 'firefox'
    : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return { ios, device, browser };
}

// Steps for installing on the current device, as a list of strings.
export function stepsFor({ ios, device, browser }) {
  const name = device === 'ipad' ? 'iPad' : 'iPhone';
  if (ios) {
    if (browser === 'chrome') return [
      `Tap the Share icon (square with an up arrow) at the right end of Chrome’s address bar${device === 'ipad' ? ' at the top' : ''}.`,
      'Choose “Add to Home Screen” (scroll the list down if you don’t see it), then tap Add.',
      `Chrome needs iPadOS/iOS 16.4 or later for this. On an older ${name}, open the page in Safari instead.`,
    ];
    if (browser === 'edge' || browser === 'firefox') return [
      `Open the ${browser === 'edge' ? '⋯' : '☰'} menu → Share → “Add to Home Screen”, then tap Add.`,
      `This needs iPadOS/iOS 16.4 or later. On an older ${name}, open the page in Safari instead.`,
    ];
    // Safari, or a browser we can't tell apart from it (iPad in desktop mode).
    return [
      `Tap the Share icon (square with an up arrow). In Safari it’s in the ${device === 'ipad' ? 'top toolbar' : 'bottom toolbar (or ⋯ menu)'}; in Chrome it’s at the right end of the address bar.`,
      'Choose “Add to Home Screen” (scroll the list down if you don’t see it), then tap Add.',
    ];
  }
  if (device === 'android') return ['Open the ⋮ menu → “Install app” (or “Add to Home screen”).'];
  if (browser === 'safari') return ['In Safari, choose File → “Add to Dock”.'];
  if (browser === 'firefox') return ['Firefox on a computer can’t install web apps. Open this page in Chrome or Edge and click the install icon in the address bar.'];
  return ['In Chrome or Edge, click the install icon at the right of the address bar (or ⋮ menu → “Install Daybook”).'];
}
