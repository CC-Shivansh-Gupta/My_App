// Small, dependency-free charts built from HTML/CSS (bars, heatmaps) and SVG
// (lines) so they stay crisp and responsive. Every mark carries a data-tip
// tooltip; colours come from CSS tokens so light/dark both work.

import { h, s } from './ui.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

// Vertical columns. data: [{label, value, tip, highlight}]
export function columns(data, { fmt = String, height = 140, labelEvery = 1, avg = null } = {}) {
  const max = niceMax(Math.max(...data.map((d) => d.value), avg || 0));
  const ticks = [max, max / 2, 0];
  return h('div', { class: 'chart' },
    h('div', { class: 'col-plot', style: { height: `${height}px` } },
      ticks.map((t) => h('div', { class: 'grid', style: { bottom: `${(t / max) * 100}%` } },
        h('span', null, fmt(t)))),
      avg ? h('div', { class: 'avg-line', style: { bottom: `${(avg / max) * 100}%` }, 'data-tip': `Average ${fmt(avg)}` }) : null,
      h('div', { class: 'cols' },
        data.map((d) => h('div', { class: 'col', 'data-tip': d.tip || `${d.label}: ${fmt(d.value)}` },
          h('div', {
            class: ['bar', d.highlight && 'hl', d.value === 0 && 'zero'],
            style: { height: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%` },
          }))))),
    h('div', { class: 'col-labels' },
      data.map((d, i) => h('span', null, i % labelEvery === 0 || i === data.length - 1 ? d.label : ''))));
}

// Horizontal bars with labels and values. data: [{key, label, value, sub, tip}]
export function hbars(data, { fmt = String, onPick = null, active = null } = {}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return h('div', { class: 'hbars' },
    data.map((d) => h(onPick ? 'button' : 'div', {
      class: ['hbar', active && active === d.key && 'on', active && active !== d.key && 'dim'],
      'data-tip': d.tip || `${d.label}: ${fmt(d.value)}`,
      onclick: onPick ? () => onPick(d) : null, type: onPick ? 'button' : null,
    },
    h('span', { class: 'hbar-label' }, d.label),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${(d.value / max) * 100}%` } })),
    h('span', { class: 'hbar-value' }, fmt(d.value), d.sub ? h('small', null, ` ${d.sub}`) : null))));
}

// Calendar heatmap: weeks as columns, weekdays as rows. cells: [{date, level(0-4|null), tip}]
export function heatmap(cells, { rows = 7 } = {}) {
  return h('div', { class: 'heatmap', style: { gridTemplateRows: `repeat(${rows}, 1fr)` } },
    cells.map((c) => h('span', {
      class: ['hm', c.level === null ? 'hm-off' : `hm-${c.level}`, c.today && 'hm-today'],
      'data-tip': c.tip,
    })));
}

// Single-series line with an area wash. points: [{label, value, tip}], values 0..max
export function line(points, { max = null, height = 120, fmt = String, labelEvery = 7 } = {}) {
  const m = max ?? niceMax(Math.max(...points.map((p) => p.value)));
  const n = points.length;
  const W = 1000; const H = 100;
  const xy = points.map((p, i) => [n === 1 ? W / 2 : (i / (n - 1)) * W, H - (p.value / m) * H]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = `${d}L${W},${H}L0,${H}Z`;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'line-svg' },
    s('path', { d: area, class: 'line-area' }),
    s('path', { d, class: 'line-path', 'vector-effect': 'non-scaling-stroke' }));
  const last = xy[xy.length - 1];
  return h('div', { class: 'chart' },
    h('div', { class: 'line-plot', style: { height: `${height}px` } },
      [m, m / 2, 0].map((t) => h('div', { class: 'grid', style: { bottom: `${(t / m) * 100}%` } }, h('span', null, fmt(t)))),
      svg,
      last ? h('span', { class: 'line-dot', style: { left: `${last[0] / 10}%`, top: `${last[1]}%` } }) : null,
      h('div', { class: 'line-hits' },
        points.map((p) => h('span', { 'data-tip': p.tip || `${p.label}: ${fmt(p.value)}` })))),
    h('div', { class: 'col-labels' },
      points.map((p, i) => h('span', null, (n - 1 - i) % labelEvery === 0 ? p.label : ''))));
}

// A thin progress/budget meter.
export function meter(frac, { state = 'ok' } = {}) {
  return h('div', { class: `meter meter-${state}` },
    h('span', { style: { width: `${Math.min(100, Math.max(0, frac * 100))}%` } }));
}
