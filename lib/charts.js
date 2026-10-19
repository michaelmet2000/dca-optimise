// Petits graphiques SVG faits main (sans librairie), lisibles sur téléphone et en mode sombre.
import { fmtInt } from './format.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Valeur « ronde » pour l'axe vertical (1, 2, 2,5 ou 5 × 10^n). */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Graphique en lignes. x = nombres croissants (index de mois ou dates en ms), y ≥ 0.
 * @param {{series:{label:string,color:string,points:[number,number][],step?:boolean,dots?:boolean,dash?:boolean}[],
 *          xLabels:[number,string][], ariaLabel:string}} o
 * @returns {string} HTML (SVG + légende)
 */
export function lineChart({ series, xLabels = [], ariaLabel = '' }) {
  const all = series.flatMap(s => s.points);
  if (!all.length) return '';
  const W = 340, H = 180, L = 40, R = 8, T = 10, B = 20;
  const xs = all.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
  const yMax = niceMax(Math.max(...all.map(p => p[1])) * 1.05);
  const x = v => L + (v - x0) / (x1 - x0) * (W - L - R);
  const y = v => T + (1 - v / yMax) * (H - T - B);
  const path = s => {
    const pts = [];
    s.points.forEach(([a, b], i) => {
      if (s.step && i > 0) pts.push(`${x(a).toFixed(1)},${y(s.points[i - 1][1]).toFixed(1)}`);
      pts.push(`${x(a).toFixed(1)},${y(b).toFixed(1)}`);
    });
    return pts.join(' ');
  };
  const grid = [0, 0.5, 1].map(f => f * yMax);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">
    ${grid.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmtInt(v)}</text>`).join('')}
    ${series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="4 3"' : ''} points="${path(s)}"/>` +
      (s.dots ? s.points.map(([a, b]) => `<circle cx="${x(a).toFixed(1)}" cy="${y(b).toFixed(1)}" r="3" fill="${s.color}"/>`).join('') : '')).join('')}
    ${xLabels.map(([v, t]) => {
      // ancrage au bord pour que la première et la dernière étiquette ne soient pas coupées
      const px = x(v), anchor = px < L + 20 ? 'start' : px > W - R - 20 ? 'end' : 'middle';
      return `<text class="axis" x="${px.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}">${esc(t)}</text>`;
    }).join('')}
  </svg>`;
  const legend = `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  return svg + legend;
}
