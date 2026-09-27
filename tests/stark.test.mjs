// The "feels like Tony Stark's JARVIS" layer: streaming speech, interrupting, the orb's
// detector, proactive notices, personality, protocols, gestures and the real-world bits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sse, partialSay, sentenceStream, remainder } from '../app/js/jarvis/stream.js';
import { createVAD } from '../app/js/jarvis/audio.js';

test('SSE chunks are reassembled across network packets', () => {
  const got = [];
  const p = sse((j) => got.push(j.choices[0].delta.content));
  p.push('data: {"choices":[{"delta":{"content":"He"}}]}\n\ndata: {"choi');
  p.push('ces":[{"delta":{"content":"llo"}}]}\n\n: keep-alive\ndata: [DONE]\n');
  p.end();
  assert.deepEqual(got, ['He', 'llo']);
});

test('the "say" text is read out of half-written JSON', () => {
  assert.equal(partialSay(''), null);
  assert.equal(partialSay('{"sa'), null);
  assert.deepEqual(partialSay('{"say":"Right away. I'), { text: 'Right away. I', done: false });
  assert.deepEqual(partialSay('{"say":"He said \\"hi\\"\\nok","do":[]}'), { text: 'He said "hi"\nok', done: true });
  assert.deepEqual(partialSay('{"say":"caf\\u00e9 and \\'), { text: 'café and ', done: false }); // escape not complete yet
  assert.deepEqual(partialSay('<think>hmm</think>```json\n{"say":"Yes'), { text: 'Yes', done: false });
  assert.equal(partialSay('<think>still thinking'), null);
  assert.equal(partialSay('Paris is the capital.').plain, true);
});

test('sentences are spoken as soon as they are complete', () => {
  const said = [];
  const s = sentenceStream((x) => said.push(x));
  s.push('Right away');
  assert.deepEqual(said, []);
  s.push('Right away. The report is due');
  assert.deepEqual(said, ['Right away.']);
  s.push('Right away. The report is due on the 3.5 km run. Dr. Rao');
  assert.deepEqual(said, ['Right away.', 'The report is due on the 3.5 km run.']);
  s.end('Right away. The report is due on the 3.5 km run. Dr. Rao called! Anything else?');
  assert.deepEqual(said, ['Right away.', 'The report is due on the 3.5 km run.', 'Dr. Rao called!', 'Anything else?']);
  assert.equal(s.spoken(), 'Right away. The report is due on the 3.5 km run. Dr. Rao called! Anything else?');
});

test('only the unsaid rest of a final reply is spoken', () => {
  assert.equal(remainder('Done. Anything else?', 'Done.'), 'Anything else?');
  assert.equal(remainder('Done.', 'Done.'), '');
  assert.equal(remainder('You have three meetings.', 'Let me check.'), 'You have three meetings.');
  assert.equal(remainder('Hello', ''), 'Hello');
});

test('talking over Jarvis is detected, its own voice is not', () => {
  const vad = createVAD({ calibrateMs: 300, holdMs: 200 });
  let t = 0;
  const feed = (v, ms) => { let hit = false; for (let end = t + ms; t < end; t += 16) hit = vad.feed(v, t) || hit; return hit; };
  assert.equal(feed(0.03, 320), false); // calibrating on Jarvis's own voice leaking back
  assert.equal(feed(0.035, 1000), false); // same level: still just Jarvis
  assert.equal(feed(0.2, 100), false); // a short knock isn't speech
  assert.equal(feed(0.03, 100), false);
  assert.equal(feed(0.2, 260), true); // you talking
  assert.equal(feed(0.2, 260), false); // only once
});

// ---- Everything below uses the store and localStorage ------------------------------------------------------
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import * as M from '../app/js/models.js';
import * as P from '../app/js/jarvis/protocols.js';
import * as promises from '../app/js/jarvis/promises.js';
import * as proactive from '../app/js/jarvis/proactive.js';
import * as persona from '../app/js/jarvis/persona.js';
import * as home from '../app/js/jarvis/home.js';
import * as world from '../app/js/jarvis/world.js';
import { status } from '../app/js/jarvis/status.js';
import { createJarvis, visionMessages } from '../app/js/jarvis/core.js';
import { createGestures, fakeHand, pose } from '../app/js/gestures.js';
import * as G3 from '../app/js/graph3d.js';
import { parseCommand } from '../app/js/intents.js';

// A localStorage for Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };
const fresh = () => { store.reset(); mem.clear(); };

const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function fakeApp() {
  const ran = []; const undone = [];
  const execute = (cmd) => {
    ran.push(cmd);
    const it = parseCommand(cmd);
    if (it.type === 'query') return { say: `Answer to ${cmd}`, title: 'Answer', answer: true };
    return { say: `Did: ${cmd}.`, title: `${it.type}: ${cmd}`, undo: () => undone.push(cmd) };
  };
  return { ran, undone, execute };
}

test('protocol steps are read line by line', () => {
  const steps = P.parseSteps('track deep work\n# a comment\ntimer 50 min Focus\nsay Hi {name}\nwait 20 minutes\nnotify Done\nhud\nhud off\nif habits left: say Go tick them\n\nlights off');
  assert.deepEqual(steps.map((s) => s.kind), ['do', 'timer', 'say', 'wait', 'notify', 'hud', 'hud', 'if', 'do']);
  assert.equal(steps[1].ms, 50 * 60000);
  assert.equal(steps[1].label, 'Focus');
  assert.equal(steps[3].ms, 20 * 60000);
  assert.equal(steps[6].on, false);
  assert.deepEqual(steps[7], { kind: 'if', cond: 'habits left', then: { kind: 'say', text: 'Go tick them' } });
});

test('protocol conditions check your day', () => {
  const env = { now: at(19, 30), status: { habits: { total: 3, done: 1 }, todos: { total: 2, done: 2 }, tasks: { overdue: 1 }, money: { over: false }, events: { upcoming: [] }, routine: { tracking: null } },
    weather: { code: 61 }, place: { name: 'Gym' } };
  for (const [c, want] of [['habits left', true], ['todos left', false], ['tasks overdue', true], ['over budget', false], ['events left', false], ['after 18:00', true],
    ['before 18:00', false], ['raining', true], ['at the gym', true], ['at home', false], ['not over budget', true], ['tracking', false], ['nonsense', false]]) {
    assert.equal(P.check(c, env), want, c);
  }
  assert.equal(P.fill('Hi {name}. Left: {habits}.', { user: 'Asha', status: { habits: { left: ['Read', 'Walk', 'Stretch'] } } }), 'Hi Asha. Left: Read, Walk and Stretch.');
});

test('protocols are engaged by name or phrase; built-ins are added on first use', () => {
  fresh();
  const focus = P.save({ name: 'Focus protocol', phrases: 'deep work time, focus mode', steps: 'say x' });
  assert.equal(focus.name, 'Focus');
  assert.equal(P.matchVoice('Engage focus protocol').protocol.id, focus.id);
  assert.equal(P.matchVoice('initiate the focus protocol').protocol.id, focus.id);
  assert.equal(P.matchVoice('deep work time').protocol.id, focus.id);
  assert.deepEqual(P.matchVoice('cancel focus protocol'), { cancel: true, protocol: focus });
  assert.deepEqual(P.matchVoice('stand down'), { cancel: true, all: true });
  assert.equal(P.matchVoice('engage good night protocol').template.name, 'Good night');
  assert.deepEqual(P.matchVoice('activate stealth protocol'), { unknown: 'stealth' });
  assert.equal(P.matchVoice('what is the tcp protocol'), null);
  assert.equal(P.matchVoice('buy milk'), null);
});

test('a protocol runs until a wait, then carries on later; timers end with an announcement', async () => {
  fresh();
  const app = fakeApp(); const said = []; const ui = [];
  P.init({ run: (c) => app.execute(c), announce: (r) => said.push(r), ui: (r) => ui.push(r), notify: () => {}, env: () => ({ user: 'Asha', status: { habits: { total: 1, done: 0, left: ['Read'] } } }) });
  const p = P.save({ name: 'Focus', steps: 'track deep work\ntimer 50 min Focus\nhud\nsay Engaged, {name}.\nwait 50 min\nstop tracking\nif habits left: say Still to do: {habits}.\nif over budget: say Never shown.' });
  const t0 = Date.UTC(2026, 8, 27, 9);
  const res = await P.engage(p, { now: t0 });
  assert.equal(res.say, 'Engaged, Asha.');
  assert.equal(res.via, 'protocol');
  assert.deepEqual(app.ran, ['track deep work']);
  assert.deepEqual(ui, ['hud']);
  assert.equal(P.timers(t0 + 1000).length, 1);
  res.undo();
  assert.deepEqual(app.undone, ['track deep work']);
  await P.tick(t0 + 10 * 60000);
  assert.deepEqual(app.ran, ['track deep work']); // still waiting
  await P.tick(t0 + 50 * 60000 + 1);
  assert.deepEqual(app.ran, ['track deep work', 'stop tracking']);
  assert.equal(said.length, 1); // the timer ended at the same moment as the wait: one announcement, not two
  assert.equal(said[0].say, 'Still to do: Read.');
  assert.equal(P.active().runs.length, 0);
  assert.equal(P.timers(t0 + 50 * 60000 + 2).length, 0);
});

test('scheduled protocols fire once a day, a little late is fine', async () => {
  fresh();
  const said = [];
  P.init({ run: () => ({ title: 'ok' }), announce: (r) => said.push(r), env: () => ({}) });
  const d = at(7, 0);
  P.save({ name: 'Morning', steps: 'say Morning.', at: '07:00', days: [d.getDay()] });
  await P.tick(at(6, 59).getTime());
  assert.equal(said.length, 0);
  await P.tick(at(7, 4).getTime());
  await P.tick(at(7, 6).getTime());
  assert.equal(said.length, 1);
  assert.equal(said[0].say, 'Morning.');
});

test('plugins run before memory and the rules, and the AI can use them too', async () => {
  fresh();
  const app = fakeApp();
  const lights = { name: 'home', via: 'home', match: (t) => (/^lights (on|off)$/i.test(t) ? { on: /on/i.test(t) } : null), run: (m) => ({ say: `Lights ${m.on ? 'on' : 'off'}.`, title: 'Lights', via: 'home' }), help: '- lights on|off' };
  const calls = [];
  const llm = { engines: () => ['local'], chat: async (e, msgs) => { calls.push(msgs); return { text: JSON.stringify({ say: 'Setting the mood.', do: ['lights off', 'remind me to buy popcorn'] }), tokens: 10 }; } };
  const J = createJarvis({ execute: app.execute, llm, plugins: () => [lights, world.plugin], now: () => at(20) });
  const r = await J.handle('Jarvis, lights off');
  assert.equal(r.via, 'home');
  assert.equal(app.ran.length, 0);
  const movie = await J.handle('I feel like watching a movie in the dark tonight honestly');
  assert.match(calls[0][0].content, /- lights on\|off/);
  assert.deepEqual(app.ran, ['remind me to buy popcorn']);
  assert.match(movie.lines.join(' '), /Lights/);
});

test('"I\'ll … tonight" becomes a to-do and a promise it follows up on', async () => {
  fresh();
  assert.deepEqual(promises.detect('I’ll finish the report tonight', '2026-09-27'), { what: 'Finish the report', when: 'tonight', date: '2026-09-27', time: '23:00' });
  assert.equal(promises.detect('I will pay rent by friday', '2026-09-27').date, '2026-10-02');
  assert.equal(promises.detect('I’ll be back in 5 minutes', '2026-09-27'), null);
  assert.equal(promises.detect('I think it will rain tomorrow', '2026-09-27'), null);
  const app = fakeApp();
  const J = createJarvis({ execute: app.execute, plugins: () => [promises.plugin] });
  const r = await J.handle('I’ll finish the report tonight');
  assert.deepEqual(app.ran, ['remind me to finish the report tonight']);
  assert.equal(r.promise.what, 'Finish the report');
  assert.match(r.say, /hold you to that/);
  assert.equal(promises.open().length, 1);
  // The next morning, not done: it comes up.
  const p = promises.open()[0];
  store.put('jarvisPromises', { ...p, date: D.addDays(D.today(), -1) });
  const due = promises.review(at(9));
  assert.equal(due.length, 1);
  assert.match(due[0].say, /You said you’d finish the report (?:last night|yesterday)/);
  assert.equal(due[0].action.cmd, 'move Finish the report to today');
  // Done after all: it notices.
  store.put('todos', { title: 'Finish the report', date: D.today(), done: true });
  const kept = promises.review(at(9));
  assert.match(kept[0].say, /and you did/);
  assert.equal(promises.open().length, 0);
});

test('the proactive watcher: the most important thing, once', () => {
  fresh();
  const now = at(21, 0);
  const t = D.toStr(now);
  store.put('events', { title: 'Call with Sam', date: t, time: hm(new Date(now.getTime() + 7 * 60000)), repeat: 'none' });
  const hb = store.put('habits', { name: 'Meditate', days: [0, 1, 2, 3, 4, 5, 6], createdAt: now.getTime() - 20 * 86400000 });
  for (let i = 1; i <= 5; i++) M.setDone(hb.id, D.addDays(t, -i), true);
  store.setPref('budget', 1000);
  store.put('expenses', { amount: 1500, note: 'rent', category: 'Bills', date: t });
  const c = proactive.candidates({ now });
  assert.equal(c[0].key.startsWith('event:'), true);
  assert.match(c[0].say, /Call with Sam starts in 7 minutes/);
  assert.ok(c.some((x) => /5-day meditate streak ends at midnight/.test(x.say)));
  assert.ok(c.some((x) => x.key.startsWith('budget-over')));
  const first = proactive.next({ now });
  proactive.markSeen(first.key, now.getTime());
  assert.notEqual(proactive.next({ now }).key, first.key);
  const rain = proactive.candidates({ now: at(14), weather: { rainNext: { at: '15:00', prob: 80 } } });
  assert.ok(rain.some((x) => /Rain’s likely around/.test(x.say)));
  const gym = proactive.candidates({ now: at(18), arrived: { name: 'gym' } });
  assert.ok(gym.some((x) => x.say.startsWith('You’re at gym')));
});

test('welcome back: only when there is something to say', () => {
  fresh();
  const now = at(18);
  assert.equal(proactive.welcomeBack(now.getTime() - 6 * 3600000, { now }), null);
  store.put('events', { title: 'Dinner', date: D.toStr(now), time: '19:30', repeat: 'none' });
  store.put('tasks', { title: 'Taxes', due: D.addDays(D.toStr(now), -2) });
  const w = proactive.welcomeBack(now.getTime() - 6 * 3600000, { now, weather: { temp: 21, text: 'clear' } });
  assert.match(w.say, /^Good evening\. Welcome back\./);
  assert.match(w.say, /Next up: Dinner/);
  assert.match(w.say, /1 task is overdue/);
});

test('personality: varied acknowledgements, remarks from your data, and a plain mode', () => {
  fresh();
  let i = 0;
  persona.setRandom(() => [0.1, 0.9, 0.5][i++ % 3]);
  const res = { say: 'Added task “Write the report”.', title: 'Task: Write the report', undo: () => {} };
  const f = persona.flavor(res);
  assert.match(f.say, /^(?:Done|Right away|Consider it done|Very good|Noted|Of course|Taken care of)\. Added task/);
  assert.equal(persona.flavor({ ...res, answer: true, undo: null }).say, res.say); // look-ups stay as they are
  store.setPref('budget', 100);
  store.put('expenses', { amount: 150, note: 'lunch', category: 'Food', date: D.today() });
  const over = persona.flavor({ say: 'Logged 150 for lunch.', title: '💸 Spent 150 on lunch', undo: () => {} });
  assert.match(over.say, /over budget.*finance department/);
  assert.doesNotMatch(persona.flavor({ say: 'Logged 5.', title: '💸 Spent 5 on tea', undo: () => {} }).say, /finance/); // said once
  store.setPref('jarvisStyle', 'plain');
  assert.equal(persona.flavor(res).say, res.say);
  assert.match(persona.prompt(), /brief/i);
  store.setPref('jarvisStyle', 'jarvis');
  store.setPref('jarvisAddress', 'sir');
  assert.match(persona.prompt(), /J\.A\.R\.V\.I\.S\..*"sir"/s);
  persona.setRandom(Math.random);
});

test('Home Assistant: phrases, and finding the right devices', async () => {
  for (const [s, want] of [
    ['turn off the kitchen lights', { action: 'off', target: 'kitchen lights' }],
    ['switch on the fan', { action: 'on', target: 'fan' }],
    ['lights off', { action: 'off', target: 'lights' }],
    ['dim the living room lights to 30%', { action: 'set', target: 'living room lights', value: 30, unit: '%' }],
    ['lights to 40 percent', { action: 'set', target: 'lights', value: 40, unit: '%' }],
    ['set the thermostat to 22 degrees', { action: 'set', target: 'thermostat', value: 22, unit: '°' }],
    ['scene movie night', { action: 'scene', target: 'movie night' }],
    ['activate the relax scene', { action: 'scene', target: 'relax' }],
    ['lock the front door', { action: 'lock', target: 'front door' }],
    ['open the garage door', { action: 'open', target: 'garage door' }],
    ['is the garage door open?', { action: 'status', target: 'garage door' }],
  ]) assert.deepEqual(home.parse(s), want, s);
  for (const s of ['set a monthly goal to 50%', 'open calendar', 'turn on notifications', 'buy milk', 'start push workout']) assert.equal(home.parse(s), null, s);
  const st = [
    { entity_id: 'light.kitchen_ceiling', state: 'on', attributes: { friendly_name: 'Kitchen ceiling light' } },
    { entity_id: 'light.kitchen_counter', state: 'off', attributes: { friendly_name: 'Kitchen counter light' } },
    { entity_id: 'light.bedroom', state: 'off', attributes: { friendly_name: 'Bedroom lamp' } },
    { entity_id: 'climate.hall', state: 'heat', attributes: { friendly_name: 'Hall thermostat', temperature: 20 } },
    { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front door' } },
    { entity_id: 'scene.movie_night', state: 'scening', attributes: { friendly_name: 'Movie night' } },
    { entity_id: 'sensor.living_temp', state: '23.5', attributes: { friendly_name: 'Living room temperature', device_class: 'temperature', unit_of_measurement: '°C' } },
  ];
  const ids = (i) => home.resolve(i, st).map((x) => x.entity_id);
  assert.deepEqual(ids(home.parse('turn off the kitchen lights')), ['light.kitchen_ceiling', 'light.kitchen_counter']);
  assert.deepEqual(ids(home.parse('lights off')), ['light.kitchen_ceiling', 'light.kitchen_counter', 'light.bedroom']);
  assert.deepEqual(ids(home.parse('set the thermostat to 21')), ['climate.hall']);
  assert.deepEqual(ids(home.parse('unlock the front door')), ['lock.front_door']);
  assert.deepEqual(ids(home.parse('scene movie night')), ['scene.movie_night']);
  assert.deepEqual(ids(home.parse('what is the temperature inside')), ['sensor.living_temp']);
  assert.deepEqual(ids(home.parse('turn on the toaster')), []);

  // Talking to it (a fake Home Assistant).
  fresh();
  home.setCfg({ url: 'https://ha.example', token: 't' });
  const posts = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') posts.push([url.replace('https://ha.example/api', ''), JSON.parse(opts.body)]);
    return { ok: true, status: 200, json: async () => (url.endsWith('/states') ? st : []) };
  };
  const r = await home.run(home.parse('dim the kitchen lights to 30%'));
  assert.equal(r.say, 'Kitchen ceiling light and Kitchen counter light at 30 percent.');
  assert.deepEqual(posts[0], ['/services/light/turn_on', { entity_id: ['light.kitchen_ceiling', 'light.kitchen_counter'], brightness_pct: 30 }]);
  const off = await home.run(home.parse('lock the front door'));
  assert.equal(off.say, 'Front door locked.');
  off.undo();
  await new Promise((r2) => setTimeout(r2, 0));
  assert.deepEqual(posts.at(-1), ['/services/lock/unlock', { entity_id: ['lock.front_door'] }]);
  assert.equal(home.plugin.match('turn on the fan').action, 'on');
  home.setCfg({ url: '', token: '' });
  assert.equal(home.plugin.match('turn on the fan'), null); // not set up: not its business
  delete globalThis.fetch;
});

test('weather: Open-Meteo in, plain English out', () => {
  const now = new Date(2026, 8, 27, 13, 20);
  const hours = Array.from({ length: 24 }, (_, i) => `2026-09-27T${String(i).padStart(2, '0')}:00`);
  const j = {
    current: { temperature_2m: 24.4, apparent_temperature: 28.1, weather_code: 2, wind_speed_10m: 9 },
    hourly: { time: hours, precipitation_probability: hours.map((_, i) => (i === 17 ? 70 : 10)), weather_code: hours.map((_, i) => (i === 17 ? 61 : 2)) },
    daily: { time: ['2026-09-27', '2026-09-28'], temperature_2m_max: [29.2, 26], temperature_2m_min: [19.6, 18], weather_code: [61, 3], precipitation_probability_max: [70, 10] },
  };
  const w = world.normalize(j, now);
  assert.equal(w.temp, 24);
  assert.equal(w.text, 'partly cloudy');
  assert.deepEqual(w.rainNext, { at: '17:00', prob: 70 });
  assert.equal(world.describe(w), '24° and partly cloudy, feels like 28°. High 29°, low 20°. 70% chance of rain around 5:00 PM.'.replace('5:00 PM', D.fmtTime('17:00')));
  assert.match(world.umbrella(w), /^I’d take one/);
  assert.match(world.tomorrowLine(w), /^Tomorrow: overcast, 26° and 18°\.$/);
  assert.match(world.umbrella({ ...w, rainNext: null, maxRain12: 5, code: 0 }), /^No\./);
  assert.match(world.jacket({ ...w, feels: 8 }), /warm one/);
  for (const [s, k] of [['what\'s the weather', 'weather'], ['weather tomorrow', 'tomorrow'], ['do I need an umbrella', 'umbrella'], ['is it going to rain', 'umbrella'],
    ['should I take a jacket', 'jacket'], ['remember this place as the gym', 'save'], ['this is my office', 'save'], ['where am I', 'where'], ['battery', 'battery']]) assert.equal(world.match(s)?.kind, k, s);
  for (const s of ['this is great', 'remember that my gym closes at 10', 'weather the storm with me']) assert.equal(world.match(s), null, s);
  const gym = { name: 'gym', lat: 12.9716, lon: 77.5946, r: 150 };
  assert.equal(world.nearPlace({ lat: 12.9717, lon: 77.5947 }, [gym]).name, 'gym');
  assert.equal(world.nearPlace({ lat: 12.99, lon: 77.59 }, [gym]), null);
});

test('hand gestures: pinch-drag rotates, two hands zoom, a quick pinch selects, a fist resets', () => {
  assert.equal(pose(fakeHand('pinch')), 'pinch');
  const g = createGestures();
  let t = 0;
  const step = (hands) => { t += 33; return g.update(hands.map((lm) => ({ landmarks: lm })), t); };
  step([fakeHand('open', { cx: 0.5 })]);
  step([fakeHand('pinch', { cx: 0.5 })]);
  const rot = step([fakeHand('pinch', { cx: 0.45 })]);
  assert.ok(rot.rotate.dx > 0.04); // hand moved left in the camera = right for you (mirrored)
  // Quick pinch without moving = select.
  const g2 = createGestures(); let t2 = 0;
  const s2 = (lm) => { t2 += 50; return g2.update(lm ? [{ landmarks: lm }] : [], t2); };
  s2(fakeHand('point'));
  assert.ok(s2(fakeHand('point')).cursor);
  s2(fakeHand('pinch'));
  s2(fakeHand('pinch'));
  assert.ok(s2(fakeHand('open')).select);
  // Two hands pinching and spreading apart = zoom in.
  const g3 = createGestures(); let t3 = 0;
  const two = (d) => { t3 += 33; return g3.update([{ landmarks: fakeHand('pinch', { cx: 0.5 - d }) }, { landmarks: fakeHand('pinch', { cx: 0.5 + d }) }], t3); };
  two(0.1);
  assert.ok(two(0.15).zoom > 1.2);
  // A fist held resets, once.
  const g4 = createGestures(); let t4 = 0;
  const fist = () => { t4 += 100; return g4.update([{ landmarks: fakeHand('fist') }], t4); };
  const resets = Array.from({ length: 15 }, fist).filter((a) => a.reset).length;
  assert.equal(resets, 1);
  // A fast swipe with an open palm = spin.
  const g5 = createGestures();
  g5.update([{ landmarks: fakeHand('open', { cx: 0.7 }) }], 0);
  assert.ok(Math.abs(g5.update([{ landmarks: fakeHand('open', { cx: 0.55 }) }], 50).spin) > 1.6);
});

test('3D map: layout settles and the camera projects', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
  const nodes = new Map(ids.map((id) => [id, { links: new Set(), backlinks: new Set() }]));
  const edges = ids.slice(1).map((id, i) => ({ a: id, b: ids[Math.floor(i / 2)] }));
  const pos = new Map();
  G3.seed3(pos, ids, { nodes });
  let moved = Infinity;
  for (let i = 0, a = 1; i < 300; i++, a *= 0.98) moved = G3.step3(pos, ids, edges, { alpha: a });
  assert.ok(moved < 1, `still moving: ${moved}`);
  G3.recenter(pos, ids);
  const cam = { yaw: 0, pitch: 0, dist: G3.fitDistance(pos, ids), fov: 1 };
  for (const id of ids) {
    const [x, y] = G3.project(pos.get(id), cam, 800, 600);
    assert.ok(x > 0 && x < 800 && y > 0 && y < 600, 'fits on screen');
  }
  assert.deepEqual(G3.project({ x: 0, y: 0, z: 0 }, { yaw: 1, pitch: 0.3, dist: 100, fov: 1 }, 800, 600).slice(0, 2), [400, 300]);
  assert.equal(G3.project({ x: 0, y: 0, z: -200 }, { yaw: 0, pitch: 0, dist: 100, fov: 1 }, 800, 600), null); // behind the camera
});

test('photos: a vision model reads them and acts through the same commands', async () => {
  fresh();
  const msgs = visionMessages({ image: 'data:image/jpeg;base64,xx', note: '', date: '2026-09-27', time: '10:00' });
  assert.equal(msgs[1].content[1].image_url.url, 'data:image/jpeg;base64,xx');
  assert.match(msgs[0].content, /receipt or bill → "spent/);
  const app = fakeApp();
  const J = createJarvis({ execute: app.execute, llm: { engines: () => [], vision: async () => ({ text: '{"say":"A receipt from Blue Tokai: 420.","do":["spent 420 on coffee at Blue Tokai"]}', engine: 'cloud', model: 'scout', tokens: 900 }) } });
  const r = await J.handleImage('data:image/jpeg;base64,xx');
  assert.deepEqual(app.ran, ['spent 420 on coffee at Blue Tokai']);
  assert.match(r.say, /Blue Tokai/);
  assert.equal(r.via, 'cloud');
  const none = createJarvis({ execute: app.execute, llm: { engines: () => [], vision: async () => { throw new Error('no vision model set up'); } } });
  const miss = await none.handleImage('data:x');
  assert.equal(miss.miss, true);
  assert.match(miss.sub, /vision model/);
});

test('HUD status sums up the day', () => {
  fresh();
  const now = at(12);
  const t = D.toStr(now);
  store.put('todos', { title: 'a', date: t, done: true });
  store.put('todos', { title: 'b', date: t });
  store.put('events', { title: 'Lunch', date: t, time: '13:00', repeat: 'none' });
  store.put('events', { title: 'Standup', date: t, time: '09:00', repeat: 'none' });
  const s = status(now);
  assert.deepEqual([s.todos.done, s.todos.total], [1, 2]);
  assert.equal(s.events.next.title, 'Lunch');
  assert.equal(s.events.upcoming.length, 1);
  assert.ok(s.day > 0.3 && s.day < 0.4);
});

test('a streamed reply is read chunk by chunk, and a server that ignores streaming still works', async () => {
  const { readStream } = await import('../app/js/jarvis/llm.js');
  const enc = new TextEncoder();
  const chunks = ['data: {"choices":[{"delta":{"content":"{\\"say\\":\\"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo.\\"}"}}]}\n\ndata: [DONE]\n\n'];
  const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
  const seen = [];
  const r = await readStream({ headers: new Headers({ 'content-type': 'text/event-stream' }), body }, (t) => seen.push(t));
  assert.equal(r.text, '{"say":"Hello."}');
  assert.deepEqual(seen, ['{"say":"Hel', '{"say":"Hello."}']);
  const plain = await readStream({ headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ choices: [{ message: { content: '{"say":"Hi"}' } }], usage: { total_tokens: 5 } }) }, (t) => seen.push(t));
  assert.equal(plain.text, '{"say":"Hi"}');
  assert.equal(plain.usage.total_tokens, 5);
});
