// TRI (taux de rendement interne) d'une série de flux datés, convention Excel XIRR.
const DAY_MS = 86400000;
const toMs = iso => Date.parse(iso + 'T00:00:00Z');

/**
 * Taux r tel que Σ montant_i / (1 + r)^((date_i − date_0) / 365) = 0.
 * Newton-Raphson, puis dichotomie si Newton ne converge pas. null si pas de solution.
 * @param {{date:string, amount:number}[]} flows sorties négatives, entrées positives
 */
export function xirr(flows) {
  if (flows.length < 2 || !flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null;
  const d0 = Math.min(...flows.map(f => toMs(f.date)));
  const t = flows.map(f => (toMs(f.date) - d0) / DAY_MS / 365);
  const npv = r => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, t[i]), 0);
  const dnpv = r => flows.reduce((s, f, i) => s - t[i] * f.amount / Math.pow(1 + r, t[i] + 1), 0);
  let r = 0.1;
  for (let k = 0; k < 100; k++) {
    const v = npv(r), d = dnpv(r);
    if (!isFinite(v) || !isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (next <= -0.999999) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  // Dichotomie sur ]−99,99 % ; 1 000 %]
  let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 300; k++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
