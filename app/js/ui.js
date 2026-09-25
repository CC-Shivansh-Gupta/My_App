// Tiny DOM helpers: h() builder, bottom sheets, toasts with undo, tooltips, icons.

import * as store from './store.js';

export function h(tag, props, ...children) {
  const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  const isSvg = el instanceof SVGElement;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false || k === 'svg') continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'indeterminate')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function s(tag, props, ...children) {
  return h(tag, { ...props, svg: true }, ...children);
}

// ---- Icons (24x24 stroke icons) -------------------------------------------
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8"/>',
  habits: '<path d="M12 21s-7.5-4.6-7.5-10.4A4.4 4.4 0 0 1 12 7.9a4.4 4.4 0 0 1 7.5 2.7C19.5 16.4 12 21 12 21z"/>',
  money: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19M16.5 15h2"/>',
  reading: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2h-1"/><path d="M7.5 8.5h6M7.5 12h6M7.5 15.5h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
  cloudOff: '<path d="m2 2 20 20M8.5 5.6A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2.6 7M17 18H7a5 5 0 0 1-2.2-9.5"/>',
  bookmark: '<path d="M6 3.5h12V21l-6-4-6 4z"/>',
  eyeOff: '<path d="m2 2 20 20M10.6 5.1A10 10 0 0 1 22 12a14 14 0 0 1-2.4 3.3M6.6 6.6A14 14 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sun: '<path d="M8 12h8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7"/>',
  goals: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>',
  gym: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2"/>',
  dots: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
};

export function icon(name, size = 22) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || '';
  return el;
}

// ---- Sheets (bottom sheet on phones, dialog on wide screens) ---------------
let openSheetEl = null;

export function closeSheet() {
  if (!openSheetEl) return;
  const el = openSheetEl;
  openSheetEl = null;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 180);
  document.body.classList.remove('sheet-open');
}

export function sheet(title, body, { actions } = {}) {
  closeSheet();
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeSheet }, icon('close'))),
    h('div', { class: 'sheet-body' }, body),
    actions ? h('div', { class: 'sheet-actions' }, actions) : null);
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) closeSheet(); } }, panel);
  document.body.append(wrap);
  document.body.classList.add('sheet-open');
  openSheetEl = wrap;
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    const first = panel.querySelector('[autofocus], input:not([type=checkbox]):not([type=hidden]), textarea');
    if (first && matchMedia('(pointer: fine)').matches) first.focus();
    else if (first && first.hasAttribute('autofocus')) first.focus();
  });
  return panel;
}

export function isSheetOpen() {
  return Boolean(openSheetEl);
}

// ---- Toasts ------------------------------------------------------------------
let toastTimer = null;
export function toast(msg, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', null, msg),
    action ? h('button', { onclick: () => { action.run(); el.remove(); } }, action.label) : null);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); }, action ? 5000 : 2200);
}

// Delete with an Undo toast instead of a confirmation dialog.
export function removeWithUndo(col, id, label = 'Deleted') {
  const prev = store.remove(col, id);
  if (prev) toast(label, { label: 'Undo', run: () => store.restore(col, prev) });
}

// ---- Tooltips (hover on desktop, tap on touch) -------------------------------
let tipEl = null;
function showTip(target) {
  const text = target.getAttribute('data-tip');
  if (!text) return;
  if (!tipEl) { tipEl = h('div', { class: 'tip', role: 'tooltip' }); document.body.append(tipEl); }
  tipEl.textContent = text;
  tipEl.style.display = 'block';
  const r = target.getBoundingClientRect();
  const tr = tipEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2;
  x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
  let y = r.top - tr.height - 8;
  if (y < 8) y = r.bottom + 8;
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && e.pointerType === 'mouse') showTip(t);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('[data-tip]')) hideTip();
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && e.pointerType !== 'mouse') showTip(t); else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);
}

// ---- Formatting ------------------------------------------------------------------
export function money(n, { compact = false } = {}) {
  const cur = store.pref('currency', '₹');
  const abs = Math.abs(n);
  let str;
  if (compact && abs >= 100000) str = (abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 }) + 'k';
  else if (compact && abs >= 10000) str = (abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k';
  else str = abs.toLocaleString(undefined, { maximumFractionDigits: abs % 1 ? 2 : 0, minimumFractionDigits: abs % 1 ? 2 : 0 });
  return (n < 0 ? '−' : '') + cur + str;
}

export function field(label, control, hint) {
  const native = ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName);
  return h(native ? 'label' : 'div', { class: 'field' }, h('span', { class: 'field-label' }, label), control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function segmented(options, value, onChange, { small = false } = {}) {
  return h('div', { class: ['seg', small && 'seg-sm'], role: 'tablist' },
    options.map(([v, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(v === value), class: v === value ? 'on' : '',
      onclick: () => onChange(v),
    }, label)));
}

export function checkbox(checked, onToggle, label = 'Mark done') {
  return h('button', {
    type: 'button', class: ['check', checked && 'on'], role: 'checkbox', 'aria-checked': String(checked),
    'aria-label': label, onclick: (e) => { e.stopPropagation(); onToggle(!checked); },
  }, icon('check', 16));
}

export function empty(text) {
  return h('p', { class: 'empty' }, text);
}

export function section(title, extra, ...children) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', null, title), extra || null),
    ...children);
}

// Text input that runs `onSubmit(value)` on Enter and clears itself.
export function quickInput(placeholder, onSubmit, { key, inputmode, type = 'text' } = {}) {
  const input = h('input', { type, placeholder, class: 'quick', 'data-key': key, inputmode, enterkeyhint: 'done', autocomplete: 'off' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
      e.preventDefault();
      const v = input.value.trim();
      input.value = '';
      onSubmit(v);
    }
  });
  return input;
}
