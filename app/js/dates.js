// Date helpers. Dates are stored as local "YYYY-MM-DD" strings, times as "HH:MM".

const pad = (n) => String(n).padStart(2, '0');

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function toStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parse(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toStr(new Date());
}

export function addDays(str, n) {
  const d = parse(str);
  d.setDate(d.getDate() + n);
  return toStr(d);
}

export function addMonths(str, n) {
  const d = parse(str);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toStr(d);
}

export function diffDays(a, b) {
  // whole days from a to b
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export function monthKey(str) {
  return str.slice(0, 7);
}

export function weekday(str) {
  return parse(str).getDay();
}

export function fmtDate(str, opts = {}) {
  const d = parse(str);
  const t = today();
  if (opts.relative !== false) {
    const diff = diffDays(t, str);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return DAY_NAMES[d.getDay()];
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: opts.weekday === false ? undefined : 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// 6x7 grid of date strings covering the month of `str`.
export function monthMatrix(str, weekStart = 1) {
  const d = parse(str);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = toStr(new Date(first.getFullYear(), first.getMonth(), 1 - offset));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) row.push(addDays(start, w * 7 + i));
    weeks.push(row);
  }
  return weeks;
}

// Does a (possibly repeating) event occur on `date`?
export function occursOn(ev, date) {
  if (!ev.date) return false;
  if (date < ev.date) return false;
  if (ev.until && date > ev.until) return false;
  if (ev.skip && ev.skip.includes(date)) return false;
  const repeat = ev.repeat || 'none';
  if (repeat === 'none') return date === ev.date;
  if (repeat === 'daily') return true;
  if (repeat === 'weekdays') { const w = weekday(date); return w > 0 && w < 6; }
  if (repeat === 'weekly') return diffDays(ev.date, date) % 7 === 0;
  if (repeat === 'monthly') return date.slice(8) === ev.date.slice(8);
  if (repeat === 'yearly') return date.slice(5) === ev.date.slice(5);
  return false;
}

// ---------------------------------------------------------------------------
// Natural-language-ish parsing for quick add: "Dentist tomorrow 3pm",
// "Call mom fri at 6:30pm", "Report due sep 30 !high #work", "Standup 9-9:30am".

const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3,
  wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };

function to24(h, m, ampm) {
  h = Number(h); m = Number(m || 0);
  if (ampm) {
    ampm = ampm.toLowerCase();
    if (ampm.startsWith('p') && h < 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function parseSmart(input, base = today()) {
  let text = ` ${input} `;
  const out = { date: null, time: null, endTime: null, priority: null, tag: null };
  const take = (re, fn) => {
    const m = text.match(re);
    if (!m) return false;
    const ok = fn(m);
    if (ok === false) return false;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    return true;
  };

  take(/\s!(high|hi|h|med|medium|m|low|lo|l|1|2|3)(?=\s)/i, (m) => {
    const v = m[1].toLowerCase();
    out.priority = /^(high|hi|h|1)$/.test(v) ? 3 : /^(med|medium|m|2)$/.test(v) ? 2 : 1;
  });
  take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (m) => { out.tag = m[1]; });

  // time ranges: 3-4pm, 9:30-10:15am, 15:00-16:00
  take(/\s(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?(?=\s)/i, (m) => {
    if (!m[3] && !m[6] && !m[2] && !m[5]) return false; // "3-4" alone is ambiguous
    const endAmpm = m[6];
    let startAmpm = m[3] || endAmpm;
    const s = to24(m[1], m[2], startAmpm);
    const e = to24(m[4], m[5], endAmpm);
    if (!s || !e) return false;
    out.time = s; out.endTime = e;
  });
  if (!out.time) {
    take(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s)/i, (m) => {
      const t = to24(m[1], m[2], m[3].replace(/\./g, ''));
      if (!t) return false;
      out.time = t;
    }) ||
    take(/\s(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/i, (m) => { out.time = `${pad(m[1])}:${m[2]}`; }) ||
    take(/\s(?:at|@)\s*(\d{1,2})(?=\s)/i, (m) => {
      let h = Number(m[1]);
      if (h > 23) return false;
      if (h >= 1 && h <= 7) h += 12; // "at 3" most likely means 3pm
      out.time = `${pad(h)}:00`;
    }) ||
    take(/\s(noon|midday)(?=\s)/i, () => { out.time = '12:00'; });
  }

  // dates
  take(/\s(today|tod|tonight)(?=\s)/i, () => { out.date = base; }) ||
  take(/\s(tomorrow|tmrw|tmr|tom)(?=\s)/i, () => { out.date = addDays(base, 1); }) ||
  take(/\s(yesterday)(?=\s)/i, () => { out.date = addDays(base, -1); }) ||
  take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)(?=\s)/i, (m) => {
    const n = Number(m[1]); const u = m[2].toLowerCase();
    out.date = u.startsWith('day') ? addDays(base, n) : u.startsWith('week') ? addDays(base, n * 7) : addMonths(base, n);
  }) ||
  take(/\s(next\s+week)(?=\s)/i, () => {
    const w = weekday(base); out.date = addDays(base, ((8 - w) % 7) || 7);
  }) ||
  take(/\s(?:on\s+)?(next\s+|this\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)(?=\s)/i, (m) => {
    const target = WEEKDAYS[m[2].toLowerCase()];
    let diff = (target - weekday(base) + 7) % 7;
    if (diff === 0) diff = 7; // "fri" said on a Friday means next week; "next fri" = the coming one
    out.date = addDays(base, diff);
  }) ||
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => { out.date = `${m[1]}-${m[2]}-${m[3]}`; }) ||
  take(/\s(?:on\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?=\s)/i, (m) => {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo === undefined) return false;
    out.date = resolveMonthDay(base, mo, Number(m[2]), m[3]);
    if (!out.date) return false;
  }) ||
  take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?(?=\s)/i, (m) => {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo === undefined) return false;
    out.date = resolveMonthDay(base, mo, Number(m[1]), m[3]);
    if (!out.date) return false;
  });

  out.title = text.replace(/\s+/g, ' ').trim();
  return out;
}

function resolveMonthDay(base, month, day, year) {
  const b = parse(base);
  let y = year ? Number(year) : b.getFullYear();
  const d = new Date(y, month, day);
  if (d.getMonth() !== month) return null;
  let s = toStr(d);
  if (!year && s < base) s = toStr(new Date(y + 1, month, day));
  return s;
}

// "250 lunch #food", "lunch 12.50", "₹1,200 groceries yesterday"
export function parseExpense(input, base = today()) {
  const smart = parseSmart(input, base);
  let text = ` ${smart.title} `;
  let amount = null;
  const m = text.match(/\s[^\d\s-]{0,3}?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)[^\d\s]{0,3}(?=\s)/);
  if (m) {
    amount = Number(m[1].replace(/,/g, ''));
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
  }
  return { amount, note: text.replace(/\s+/g, ' ').trim(), date: smart.date || base, category: smart.tag };
}
