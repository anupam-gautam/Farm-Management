// Lightweight hand-rolled SVG charts — no external library.

const COLORS = {
  green: '#2d6a4f',
  amber: '#d97706',
  blue: '#2563eb',
  stone: '#a8a29e',
  red: '#dc2626',
};

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Horizontal bar chart.
 * @param {{ label: string, value: number, color?: string }[]} bars
 */
export function horizontalBarChart(bars, { width = 320, height = 40, labelWidth = 100 } = {}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const barH = Math.min(28, Math.floor((height - 8) / Math.max(bars.length, 1)));
  const chartW = width - labelWidth - 16;
  const totalH = bars.length * (barH + 6) + 4;

  const rows = bars.map((b, i) => {
    const y = 4 + i * (barH + 6);
    const w = Math.round((b.value / max) * chartW);
    const color = b.color || COLORS.green;
    return `
      <text x="0" y="${y + barH * 0.72}" class="fill-stone-600 text-[10px]">${esc(b.label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${chartW}" height="${barH}" rx="4" class="fill-stone-100"/>
      <rect x="${labelWidth}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${color}"/>
      <text x="${labelWidth + chartW + 4}" y="${y + barH * 0.72}" class="fill-stone-700 text-[10px] font-bold">${b.value}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${totalH}" width="100%" height="${totalH}" role="img" aria-hidden="true">${rows}</svg>`;
}

/**
 * Vertical bar chart for time-series buckets.
 * @param {{ label: string, value: number }[]} bars
 */
export function verticalBarChart(bars, { width = 320, height = 140, color = COLORS.green } = {}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const pad = { t: 8, r: 8, b: 28, l: 8 };
  const chartW = width - pad.l - pad.r;
  const chartH = height - pad.t - pad.b;
  const slot = chartW / Math.max(bars.length, 1);
  const barW = Math.max(4, slot * 0.6);

  const cols = bars.map((b, i) => {
    const h = Math.round((b.value / max) * chartH);
    const x = pad.l + i * slot + (slot - barW) / 2;
    const y = pad.t + chartH - h;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${color}"/>
      <text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="fill-stone-500 text-[8px]">${esc(b.label)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-hidden="true">${cols}</svg>`;
}

/**
 * Donut chart for proportional segments.
 * @param {{ label: string, value: number, color: string }[]} segments
 */
export function donutChart(segments, { size = 120, stroke = 18 } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  const arcs = segments.map((seg) => {
    const frac = seg.value / total;
    const dash = frac * circ;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
      stroke-width="${stroke}" stroke-dasharray="${dash} ${circ - dash}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
    return el;
  }).join('');

  const legend = segments.map((seg, i) => `
    <text x="${size + 8}" y="${16 + i * 18}" class="fill-stone-700 text-[10px]">
      <tspan fill="${seg.color}">●</tspan> ${esc(seg.label)} (${seg.value})
    </text>`).join('');

  const w = size + 120;
  return `<svg viewBox="0 0 ${w} ${size}" width="100%" height="${size}" role="img" aria-hidden="true">
    ${arcs}
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="fill-stone-800 text-sm font-bold">${total}</text>
    ${legend}
  </svg>`;
}

export { COLORS };
