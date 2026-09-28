// What's around you: the weather (Open-Meteo: free, no key, no sign-up), your battery, and
// places you've named ("remember this place as the gym"), so Jarvis can say "you're at the gym".
// Location is only read while the app is open, and only after you allow it. The weather is
// cached for 20 minutes, so a question costs one small request at most.

import * as store from '../store.js';
import * as D from '../dates.js';

const KEY = 'daybook.world.v1';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

export function cfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* default */ }
  return { on: false, lat: null, lon: null, label: '', auto: true, cache: null, ...c };
}
export function setCfg(patch) {
  const next = { ...cfg(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

// ---- Weather ---------------------------------------------------------------------------------------------
// WMO weather codes → words and an emoji.
export const WMO = {
  0: ['clear', '☀️'], 1: ['mostly clear', '🌤️'], 2: ['partly cloudy', '⛅'], 3: ['overcast', '☁️'], 45: ['foggy', '🌫️'], 48: ['foggy', '🌫️'],
  51: ['light drizzle', '🌦️'], 53: ['drizzle', '🌦️'], 55: ['heavy drizzle', '🌧️'], 56: ['freezing drizzle', '🌧️'], 57: ['freezing drizzle', '🌧️'],
  61: ['light rain', '🌦️'], 63: ['rain', '🌧️'], 65: ['heavy rain', '🌧️'], 66: ['freezing rain', '🌧️'], 67: ['freezing rain', '🌧️'],
  71: ['light snow', '🌨️'], 73: ['snow', '🌨️'], 75: ['heavy snow', '❄️'], 77: ['snow grains', '🌨️'], 80: ['showers', '🌦️'], 81: ['showers', '🌧️'],
  82: ['violent showers', '⛈️'], 85: ['snow showers', '🌨️'], 86: ['snow showers', '❄️'], 95: ['thunderstorms', '⛈️'], 96: ['thunderstorms with hail', '⛈️'], 99: ['thunderstorms with hail', '⛈️'],
};
const wmo = (c) => WMO[c] || ['unsettled', '🌡️'];
const WET = (c) => c >= 51;

// Open-Meteo's JSON → what Jarvis talks about. `now` picks the coming hours.
export function normalize(j, now = new Date()) {
  const cur = j.current || {};
  const hourly = j.hourly || {};
  const nowIso = `${D.toStr(now)}T${String(now.getHours()).padStart(2, '0')}:00`;
  const start = Math.max(0, (hourly.time || []).findIndex((t) => t >= nowIso));
  const next = (hourly.time || []).slice(start, start + 12).map((t, i) => ({ t, p: hourly.precipitation_probability?.[start + i] ?? 0, code: hourly.weather_code?.[start + i] ?? 0 }));
  const rain = next.find((x) => x.p >= 50 || WET(x.code)) || null;
  const daily = j.daily || {};
  const day = (i) => (daily.time?.[i] ? { date: daily.time[i], hi: Math.round(daily.temperature_2m_max[i]), lo: Math.round(daily.temperature_2m_min[i]),
    code: daily.weather_code[i], rain: daily.precipitation_probability_max?.[i] ?? 0 } : null);
  const [text, emoji] = wmo(cur.weather_code);
  return {
    temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature ?? cur.temperature_2m), code: cur.weather_code, text, emoji,
    wind: Math.round(cur.wind_speed_10m || 0), today: day(0), tomorrow: day(1),
    rainNext: rain ? { at: rain.t.slice(11, 16), prob: rain.p } : null,
    maxRain12: Math.max(0, ...next.map((x) => x.p)),
  };
}

const hour = (hm) => D.fmtTime(hm);

export function describe(w, { place = '' } = {}) {
  if (!w) return '';
  const where = place ? ` in ${place}` : '';
  const parts = [`${w.temp}°${where} and ${w.text}${Math.abs(w.feels - w.temp) >= 3 ? `, feels like ${w.feels}°` : ''}.`];
  if (w.today) parts.push(`High ${w.today.hi}°, low ${w.today.lo}°.`);
  if (w.rainNext) parts.push(`${w.rainNext.prob}% chance of rain around ${hour(w.rainNext.at)}.`);
  return parts.join(' ');
}

export function tomorrowLine(w) {
  const d = w?.tomorrow;
  if (!d) return 'I don’t have tomorrow’s forecast.';
  return `Tomorrow: ${wmo(d.code)[0]}, ${d.hi}° and ${d.lo}°${d.rain >= 30 ? `, ${d.rain}% chance of rain` : ''}.`;
}

export function umbrella(w) {
  if (!w) return null;
  if (WET(w.code)) return `Yes. It’s ${w.text} right now.`;
  if (w.rainNext && w.rainNext.prob >= 50) return `I’d take one. ${w.rainNext.prob}% chance of rain around ${hour(w.rainNext.at)}.`;
  if (w.maxRain12 >= 30) return `Probably not, but it’s not impossible: up to ${w.maxRain12}% chance of rain later.`;
  return 'No. It should stay dry for the next twelve hours.';
}

export function jacket(w) {
  if (!w) return null;
  const low = Math.min(w.feels, w.today?.lo ?? w.feels);
  if (low <= 10) return `Yes, a warm one. It gets down to ${low}°.`;
  if (low <= 17) return `A light one. It dips to ${low}°.`;
  return `No need. It stays above ${low}°.`;
}

export async function locate() {
  if (!navigator.geolocation) throw new Error('This browser can’t share your location.');
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 10 * 60000, timeout: 12000 }));
  const p = { lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4), acc: pos.coords.accuracy };
  lastPos = { ...p, at: Date.now() };
  return p;
}
let lastPos = null;
export const lastPosition = () => lastPos;

export async function geocode(name) {
  const res = await fetch(`${GEOCODE}?name=${encodeURIComponent(name)}&count=1&format=json`);
  const j = await res.json();
  const r = j.results?.[0];
  if (!r) throw new Error(`I couldn’t find ${name}.`);
  return { lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', ') };
}

// The current weather (cached 20 minutes). Needs a place: your location, or one you set.
export async function weather({ force = false, now = new Date() } = {}) {
  let c = cfg();
  if (!force && c.cache && Date.now() - c.cache.at < 20 * 60000) return c.cache.w;
  if (c.auto || c.lat == null) {
    try { const p = await locate(); c = setCfg({ lat: p.lat, lon: p.lon, on: true }); } catch (e) { if (c.lat == null) throw new Error('I need your location for the weather: allow it, or set a city on the Jarvis page.'); }
  }
  const q = new URLSearchParams({
    latitude: c.lat, longitude: c.lon, timezone: 'auto', forecast_days: '2',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const res = await fetch(`${FORECAST}?${q}`);
  if (!res.ok) throw new Error(`Weather service ${res.status}`);
  const w = normalize(await res.json(), now);
  setCfg({ cache: { at: Date.now(), w } });
  return w;
}

// The last weather we have, without fetching (for the AI's snapshot and the HUD).
export function cached() {
  const c = cfg().cache;
  return c && Date.now() - c.at < 3 * 3600000 ? c.w : null;
}

// ---- Battery ------------------------------------------------------------------------------------------------
export async function battery() {
  try {
    const b = await navigator.getBattery?.();
    return b ? { level: Math.round(b.level * 100), charging: b.charging } : null;
  } catch { return null; }
}

// ---- Places -------------------------------------------------------------------------------------------------
export function places() { return store.pref('places', []); }

export function distanceM(a, b) {
  const R = 6371000; const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function nearPlace(pos, list = places()) {
  if (!pos) return null;
  let best = null;
  for (const p of list) {
    const d = distanceM(pos, p);
    if (d <= (p.r || 150) && (!best || d < best.d)) best = { ...p, d };
  }
  return best;
}

export function savePlace(name, pos) {
  const n = String(name).trim().replace(/^(?:the|my)\s+/i, '');
  const list = places().filter((p) => p.name.toLowerCase() !== n.toLowerCase());
  list.push({ name: n, lat: pos.lat, lon: pos.lon, r: 150 });
  store.setPref('places', list);
  return n;
}

export function forgetPlace(name) {
  const n = String(name).trim().replace(/^(?:the|my)\s+/i, '').toLowerCase();
  const list = places();
  const next = list.filter((p) => p.name.toLowerCase() !== n);
  store.setPref('places', next);
  return next.length < list.length;
}

// ---- Talking about it ---------------------------------------------------------------------------------------
const WEATHER = /^(?:what(?:'s| is) the |how(?:'s| is) the )?(?:weather|forecast|temperature)(?:\s+(?:like\s+)?(?:today|now|outside|right now|here))?(?:\s+like)?\??$|^(?:how (?:hot|cold|warm) is it|is it (?:hot|cold|warm) outside)\??$/i;
const WEATHER_TOMORROW = /^(?:what(?:'s| is) the )?(?:weather|forecast)\s+(?:for\s+|like\s+)?tomorrow\??$|^what(?:'s| is| will) (?:the weather|it) (?:be )?like tomorrow\??$/i;
const UMBRELLA = /^(?:do i need|should i (?:take|bring|carry)|will i need) (?:an? )?umbrella|^(?:is it|will it|is it going to) (?:rain|be raining)/i;
const JACKET = /^(?:do i need|should i (?:take|bring|wear)|will i need) (?:a )?(?:jacket|coat|sweater|hoodie)/i;
const SAVE_PLACE = /^(?:remember (?:this|here) (?:place )?as|this (?:place )?is (?=my |the )|save (?:this|here) as|mark (?:this|here) as)\s*(?:my |the )?([\p{L}][\p{L}\p{N} '’-]{1,30})$/iu;
const FORGET_PLACE = /^forget (?:the )?place\s+(.+)$/i;
const WHERE = /^(?:where am i|where are we)\??$/i;
const BATTERY = /^(?:(?:what(?:'s| is) (?:my |the )?)?battery(?: level)?|how much battery(?: do i have| is left)?)\??$/i;

export function match(t) {
  const s = t.trim().replace(/[’]/g, "'");
  if (WEATHER_TOMORROW.test(s)) return { kind: 'tomorrow' };
  if (WEATHER.test(s)) return { kind: 'weather' };
  if (UMBRELLA.test(s)) return { kind: 'umbrella' };
  if (JACKET.test(s)) return { kind: 'jacket' };
  let m = s.match(SAVE_PLACE);
  if (m && !/^(?:a|an|it|so|not|what|how|why|the best|great|good|bad|wrong|right)\b/i.test(m[1])) return { kind: 'save', name: m[1].trim() };
  m = s.match(FORGET_PLACE);
  if (m) return { kind: 'forget', name: m[1] };
  if (WHERE.test(s)) return { kind: 'where' };
  if (BATTERY.test(s)) return { kind: 'battery' };
  return null;
}

export async function run(m) {
  try {
    if (m.kind === 'weather' || m.kind === 'tomorrow' || m.kind === 'umbrella' || m.kind === 'jacket') {
      const w = await weather();
      const label = cfg().auto ? '' : cfg().label;
      if (m.kind === 'tomorrow') return { say: tomorrowLine(w), title: `${w.tomorrow ? wmo(w.tomorrow.code)[1] : '🌡️'} Tomorrow`, sub: tomorrowLine(w), answer: true };
      const say = m.kind === 'umbrella' ? umbrella(w) : m.kind === 'jacket' ? jacket(w) : describe(w, { place: label });
      return { say, title: `${w.emoji} ${w.temp}° · ${w.text}`, sub: describe(w, { place: label }), answer: true };
    }
    if (m.kind === 'save') {
      const p = await locate();
      const n = savePlace(m.name, p);
      return { say: `Noted. This is ${n}. I’ll recognise it when you’re here.`, title: `📍 Saved place: ${n}`, sub: `${p.lat}, ${p.lon}`, undo: () => forgetPlace(n) };
    }
    if (m.kind === 'forget') {
      return forgetPlace(m.name) ? { say: `Forgotten ${m.name}.`, title: `📍 Forgot ${m.name}` } : { say: `I don’t know a place called ${m.name}.`, title: 'No such place', miss: true };
    }
    if (m.kind === 'where') {
      const p = await locate();
      const at = nearPlace(p);
      return at ? { say: `You’re at ${at.name}.`, title: `📍 ${at.name}`, answer: true }
        : { say: 'Somewhere I don’t have a name for. Say “remember this place as …” to name it.', title: `📍 ${p.lat}, ${p.lon}`, answer: true };
    }
    if (m.kind === 'battery') {
      const b = await battery();
      return b ? { say: `${b.level} percent${b.charging ? ', and charging' : ''}.`, title: `🔋 ${b.level}%${b.charging ? ' · charging' : ''}`, answer: true }
        : { say: 'This browser doesn’t tell me the battery level.', title: 'Battery unknown', miss: true };
    }
  } catch (e) {
    return { say: e.message || 'I couldn’t get that.', title: 'Couldn’t check', sub: e.message, miss: true };
  }
  return null;
}

export const plugin = {
  name: 'world', via: 'world', match, run: (m) => run(m),
  help: '- weather: "what\'s the weather", "weather tomorrow", "do I need an umbrella"; places: "remember this place as <name>", "where am I"; "battery"',
};
