// Affichage au format suisse : 1'500 CHF, −12,34 %, 31/08/2026.

const NBSP = ' ';
const MINUS = '−';

/** Entier avec apostrophe comme séparateur de milliers : 1500 -> "1'500". */
export function fmtInt(n) {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (n < 0 && Math.round(n) !== 0 ? MINUS : '') + s;
}

/** Nombre avec décimales, virgule décimale : 7651.54 -> "7'651,54". */
export function fmtNum(n, decimals = 2) {
  const neg = n < 0;
  const [i, d] = Math.abs(n).toFixed(decimals).split('.');
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, "'") + (d ? ',' + d : '');
  return (neg && Number(n.toFixed(decimals)) !== 0 ? MINUS : '') + s;
}

export const fmtCHF = n => `${fmtInt(n)}${NBSP}CHF`;

/**
 * Drawdown en %, TRONQUÉ vers zéro à 2 décimales (pas arrondi) : un DD de −9,996 % s'affiche
 * « −9,99 % » et reste dans le palier > −10 %. L'affichage ne contredit ainsi jamais le palier.
 */
export function fmtDD(dd) {
  const bp = Math.trunc(dd * 1e4); // centièmes de % ; même valeur que celle qui choisit le palier
  if (bp === 0) return `0,00${NBSP}%`;
  const abs = Math.abs(bp);
  return `${bp < 0 ? MINUS : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}${NBSP}%`;
}

/** Pourcentage arrondi (rendements, écarts) : 0.1 -> "10,0 %". */
export function fmtPct(x, decimals = 1) {
  return `${fmtNum(x * 100, decimals)}${NBSP}%`;
}

/** "2026-08-31" -> "31/08/2026". */
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** "2026-10" -> "octobre 2026". */
export function fmtMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
