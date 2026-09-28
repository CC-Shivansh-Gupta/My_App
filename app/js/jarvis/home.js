// Your home, through Home Assistant's REST API: "lights to 30%", "turn off the kitchen lights",
// "set the thermostat to 22", "scene movie night", "lock the front door", "is the garage open?".
// Instant and rule-based; the AI can use the same phrases in its commands and protocols can too.
//
// Needs your Home Assistant URL (HTTPS, e.g. Nabu Casa or your own proxy: a page served over
// HTTPS can't call http://homeassistant.local) with this site in `http: cors_allowed_origins`,
// and a long-lived access token (Profile → Security). The token travels with sync, encrypted.

import { bestMatch } from '../intents.js';

const KEY = 'daybook.home.v1';

export function cfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* default */ }
  return { url: '', token: '', ...c };
}
export function setCfg(patch) {
  const next = { ...cfg(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  cache = null;
  return next;
}
export const connected = () => Boolean(cfg().url && cfg().token);

// ---- Understanding what you said ------------------------------------------------------------------------
const THE = '(?:the |my |all (?:the )?|all of the )?';
const RULES = [
  [new RegExp(`^(?:turn|switch|flip|put)\\s+(on|off)\\s+${THE}(.+)$`, 'i'), (m) => ({ action: m[1].toLowerCase(), target: m[2] })],
  [new RegExp(`^(?:turn|switch|flip|put)\\s+${THE}(.+?)\\s+(on|off)$`, 'i'), (m) => ({ action: m[2].toLowerCase(), target: m[1] })],
  [new RegExp(`^${THE}(lights?|lamps?|fans?|tv|television|heater|ac|air ?con(?:ditioning)?|.+? (?:lights?|lamps?|fans?|tv|heater))\\s+(on|off)$`, 'i'), (m) => ({ action: m[2].toLowerCase(), target: m[1] })],
  [new RegExp(`^(?:dim|brighten|set|put|turn)\\s+${THE}(.+?)\\s+(?:to|at)\\s+(\\d{1,3})\\s*(?:%|percent|per cent)$`, 'i'), (m) => ({ action: 'set', target: m[1], value: Number(m[2]), unit: '%' })],
  [new RegExp(`^${THE}((?:.+? )?(?:lights?|lamps?))\\s+(?:to|at)\\s+(\\d{1,3})\\s*(?:%|percent|per cent)?$`, 'i'), (m) => ({ action: 'set', target: m[1], value: Number(m[2]), unit: '%' })],
  [new RegExp(`^(?:set|turn|put)\\s+${THE}(thermostat|heating|heat|ac|air ?con(?:ditioning)?|temperature|climate|.+? thermostat)\\s+(?:to|at)\\s+(\\d{1,2}(?:\\.\\d)?)\\s*(?:°|degrees?)?(?:\\s*[cf])?$`, 'i'), (m) => ({ action: 'set', target: m[1], value: Number(m[2]), unit: '°' })],
  [/^(?:activate|run|start|turn on|set)\s+(?:the\s+)?scene\s+(.+)$|^(?:activate|run|start)\s+(?:the\s+)?(.+?)\s+scene$|^scene\s+(.+)$/i, (m) => ({ action: 'scene', target: m[1] || m[2] || m[3] })],
  [new RegExp(`^(lock|unlock)\\s+${THE}(.+)$`, 'i'), (m) => ({ action: m[1].toLowerCase(), target: m[2] })],
  [new RegExp(`^(open|close|raise|lower)\\s+${THE}(.+?(?:blinds?|curtains?|shades?|shutters?|garage(?: door)?|gate|cover))$`, 'i'), (m) => ({ action: /open|raise/i.test(m[1]) ? 'open' : 'close', target: m[2] })],
  [new RegExp(`^(?:is|are)\\s+${THE}(.+?)\\s+(on|off|open|closed|locked|unlocked)\\??$`, 'i'), (m) => ({ action: 'status', target: m[1] })],
  [/^(?:what(?:'s| is) the )?(?:temperature|humidity) (?:inside|indoors|at home|in (?:the )?(.+?))\??$/i, (m) => ({ action: 'status', target: m[1] || 'temperature', sensor: true })],
];
const NOT_HOME = /\b(?:goal|budget|reminder|timer|alarm|habit|task|to-?do|note|tracking|workout|protocol|notifications?|wake word|voice)\b/i;

export function parse(text) {
  const t = String(text || '').trim().replace(/[’]/g, "'").replace(/[.!]+$/, '');
  if (NOT_HOME.test(t)) return null;
  for (const [re, make] of RULES) {
    const m = t.match(re);
    if (m) { const r = make(m); r.target = r.target.trim().replace(/^(?:the|my)\s+/i, ''); return r; }
  }
  return null;
}

// ---- Finding the device ------------------------------------------------------------------------------------
const DOMAINS = {
  on: ['light', 'switch', 'fan', 'media_player', 'climate', 'input_boolean', 'humidifier', 'automation'],
  off: ['light', 'switch', 'fan', 'media_player', 'climate', 'input_boolean', 'humidifier', 'automation'],
  set: ['light', 'fan', 'climate', 'cover', 'media_player'], scene: ['scene', 'script'],
  lock: ['lock'], unlock: ['lock'], open: ['cover'], close: ['cover'],
  status: ['lock', 'cover', 'light', 'switch', 'binary_sensor', 'sensor', 'climate', 'fan'],
};
const nameOf = (s) => s.attributes?.friendly_name || s.entity_id.split('.')[1].replace(/_/g, ' ');
const domainOf = (s) => s.entity_id.split('.')[0];
const plural = (w) => /s$/.test(w);

// Returns the entities an intent applies to (several for "the lights" / "kitchen lights").
export function resolve(intent, states) {
  const pool = states.filter((s) => (DOMAINS[intent.action] || []).includes(domainOf(s)));
  const target = intent.target.toLowerCase().replace(/^all\s+/, '');
  if (intent.sensor) {
    const kind = /humid/i.test(target) ? 'humidity' : 'temperature';
    const sensors = states.filter((s) => domainOf(s) === 'sensor' && (s.attributes?.device_class === kind || new RegExp(kind, 'i').test(nameOf(s))));
    const m = target === 'temperature' ? sensors[0] : bestMatch(target, sensors, nameOf, 0.4);
    return m ? [m] : sensors.slice(0, 1);
  }
  if (/^(?:thermostat|heating|heat|ac|air ?con(?:ditioning)?|temperature|climate)$/.test(target)) return pool.filter((s) => domainOf(s) === 'climate').slice(0, 1);
  // "lights", "the kitchen lights", "all lights": every matching light.
  const kindWord = target.match(/\b(lights?|lamps?|fans?)$/);
  if (kindWord) {
    const dom = /fan/.test(kindWord[1]) ? 'fan' : 'light';
    const room = target.slice(0, kindWord.index).trim();
    const ofKind = states.filter((s) => domainOf(s) === dom);
    if (!room) return plural(kindWord[1]) ? ofKind : ofKind.slice(0, 1);
    const inRoom = ofKind.filter((s) => nameOf(s).toLowerCase().includes(room));
    if (inRoom.length) return plural(kindWord[1]) ? inRoom : [bestMatch(target, inRoom, nameOf, 0) || inRoom[0]];
  }
  const one = bestMatch(target, pool, nameOf, 0.5);
  return one ? [one] : [];
}

// ---- Talking to Home Assistant ------------------------------------------------------------------------------
let cache = null; // { at, states }
async function api(path, { method = 'GET', body } = {}) {
  const c = cfg();
  let res;
  try {
    res = await fetch(`${c.url.replace(/\/+$/, '')}/api${path}`, { method, headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('I can’t reach Home Assistant. Check it’s on HTTPS and this site is in cors_allowed_origins.');
  }
  if (res.status === 401) throw new Error('Home Assistant rejected the token.');
  if (!res.ok) throw new Error(`Home Assistant said ${res.status}.`);
  return res.json();
}

export async function states({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.states;
  const s = await api('/states');
  cache = { at: Date.now(), states: s };
  return s;
}
export const cachedStates = () => cache?.states || [];

export async function test() {
  const s = await states({ force: true });
  const count = (d) => s.filter((x) => domainOf(x) === d).length;
  return { total: s.length, lights: count('light'), switches: count('switch'), climate: count('climate'), scenes: count('scene'), locks: count('lock') };
}

const SERVICE = {
  on: () => ['homeassistant', 'turn_on'], off: () => ['homeassistant', 'turn_off'],
  lock: () => ['lock', 'lock'], unlock: () => ['lock', 'unlock'], open: () => ['cover', 'open_cover'], close: () => ['cover', 'close_cover'],
};

const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export async function run(intent) {
  let all;
  try { all = await states(); } catch (e) { return { say: e.message, title: 'Home Assistant unreachable', miss: true, via: 'home' }; }
  const ents = resolve(intent, all);
  if (!ents.length) return { say: `I can’t find ${intent.target} in Home Assistant.`, title: `🏠 No “${intent.target}”`, miss: true, via: 'home' };
  const names = ents.map(nameOf);
  const ids = ents.map((s) => s.entity_id);
  const who = ents.length > 3 ? `${ents.length} ${intent.target}` : list(names);
  try {
    if (intent.action === 'status') {
      const lines = ents.map((s) => `${nameOf(s)}: ${s.state}${s.attributes?.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : ''}`);
      return { say: lines.join('. '), title: '🏠 Home', lines, answer: true, via: 'home' };
    }
    if (intent.action === 'scene') {
      const e = ents[0];
      await api(`/services/${domainOf(e)}/turn_on`, { method: 'POST', body: { entity_id: e.entity_id } });
      return { say: `${nameOf(e)} scene is on.`, title: `🏠 Scene: ${nameOf(e)}`, via: 'home' };
    }
    if (intent.action === 'set') {
      const e = ents[0];
      const d = domainOf(e);
      if (d === 'climate') {
        await api('/services/climate/set_temperature', { method: 'POST', body: { entity_id: e.entity_id, temperature: intent.value } });
        const prev = e.attributes?.temperature;
        return { say: `${nameOf(e)} set to ${intent.value} degrees.`, title: `🌡️ ${nameOf(e)} → ${intent.value}°`, via: 'home',
          undo: prev != null ? () => api('/services/climate/set_temperature', { method: 'POST', body: { entity_id: e.entity_id, temperature: prev } }).catch(() => {}) : null };
      }
      if (d === 'cover') { await api('/services/cover/set_cover_position', { method: 'POST', body: { entity_id: e.entity_id, position: intent.value } }); return { say: `${nameOf(e)} to ${intent.value} percent.`, title: `🏠 ${nameOf(e)} → ${intent.value}%`, via: 'home' }; }
      if (d === 'fan') { await api('/services/fan/set_percentage', { method: 'POST', body: { entity_id: ids, percentage: intent.value } }); return { say: `${who} to ${intent.value} percent.`, title: `🌀 ${who} → ${intent.value}%`, via: 'home' }; }
      if (d === 'media_player') { await api('/services/media_player/volume_set', { method: 'POST', body: { entity_id: e.entity_id, volume_level: intent.value / 100 } }); return { say: `Volume at ${intent.value}.`, title: `🔊 ${nameOf(e)} → ${intent.value}%`, via: 'home' }; }
      const lights = ents.filter((x) => domainOf(x) === 'light').map((x) => x.entity_id);
      await api('/services/light/turn_on', { method: 'POST', body: { entity_id: lights, brightness_pct: Math.max(1, Math.min(100, intent.value)) } });
      return { say: `${who} at ${intent.value} percent.`, title: `💡 ${who} → ${intent.value}%`, via: 'home',
        undo: () => Promise.all(ents.map((x) => (x.state === 'off' ? api('/services/light/turn_off', { method: 'POST', body: { entity_id: x.entity_id } })
          : api('/services/light/turn_on', { method: 'POST', body: { entity_id: x.entity_id, brightness: x.attributes?.brightness ?? 255 } })))).catch(() => {}) };
    }
    const [domain, service] = SERVICE[intent.action](domainOf(ents[0]));
    await api(`/services/${domain}/${service}`, { method: 'POST', body: { entity_id: ids } });
    const opposite = { on: 'off', off: 'on', lock: 'unlock', unlock: 'lock', open: 'close', close: 'open' }[intent.action];
    const verb = { on: 'on', off: 'off', lock: 'locked', unlock: 'unlocked', open: 'opening', close: 'closing' }[intent.action];
    return { say: `${who} ${verb}.`, title: `🏠 ${who} ${verb}`, via: 'home',
      undo: () => { const [d2, s2] = SERVICE[opposite](domainOf(ents[0])); api(`/services/${d2}/${s2}`, { method: 'POST', body: { entity_id: ids } }).catch(() => {}); } };
  } catch (e) {
    return { say: e.message, title: 'Home Assistant', miss: true, via: 'home' };
  } finally { cache = null; }
}

export const plugin = {
  name: 'home', via: 'home',
  // Only when Home Assistant is set up; "open …" only for things it actually has (blinds, garage…).
  match: (t) => (connected() ? parse(t) : null),
  run: (intent) => run(intent),
  get help() { return connected() ? '- smart home (Home Assistant): "turn on|off <device or room lights>", "set <light> to <n>%", "set thermostat to <n>", "scene <name>", "lock|unlock <door>", "is the <device> on?"' : ''; },
};
