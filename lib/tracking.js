// Suivi personnel du DCA (onglet « Mon suivi ») : calculs purs, sans DOM ni stockage, testés à part.
// Montants en CHF. Les dates sont des chaînes "AAAA-MM-JJ".
import { addMonths, monthOf, investDateOf, pointBefore, lastIndexBefore, tierIndex, scaledAmount, previousWeekday } from './model.js';

const DAY_MS = 86400000;
const toMs = iso => Date.parse(iso + 'T00:00:00Z');
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);

// ---------- Mois suivis ----------

/**
 * Mois du DCA, du premier mois d'investissement au mois en cours.
 * - Premier mois : celui de la date de départ, sauf si son jour d'investissement est déjà passé à cette date.
 * - Mois en cours : compté seulement si son jour d'investissement est arrivé, ou s'il a déjà une saisie.
 */
export function trackedMonths(startDate, todayIso, day, investments = []) {
  if (!startDate || startDate > todayIso) return [];
  let first = monthOf(startDate);
  if (startDate > investDateOf(first, day)) first = addMonths(first, 1);
  const current = monthOf(todayIso);
  const currentDone = todayIso >= investDateOf(current, day) || investments.some(i => monthOf(i.date) === current);
  const last = currentDone ? current : addMonths(current, -1);
  const months = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);
  return months;
}

// ---------- Montant recommandé d'un mois ----------

/**
 * Montant recommandé pour le mois `month` : palier du DD à la dernière clôture avant le jour d'investissement.
 * Renvoie null si l'historique ne permet pas de le calculer (avant `validFrom`, ou aucune clôture).
 * `estimate` = true si la clôture de la veille du jour d'investissement n'est pas encore connue.
 */
export function recommendedFor(month, { peaked, tiers, budget, day, nominalBudget = 1200, roundTo = 10, validFrom = null }) {
  const investDate = investDateOf(month, day);
  const p = pointBefore(peaked, investDate);
  if (!p || (validFrom && p.date < validFrom)) return null;
  const tier = tierIndex(p.dd, tiers);
  const lastDate = peaked.at(-1).date;
  return {
    month, investDate, closeDate: p.date, dd: p.dd, tier,
    amount: scaledAmount(tiers[tier].amount, budget, nominalBudget, roundTo),
    estimate: lastDate < previousWeekday(investDate),
  };
}

// ---------- Indicateurs ----------

/** Respect de l'objectif : N, total, moyenne, écart, réserve, mois manqués, recommandé. */
export function objectiveStats({ months, investments, budget, recommended = [] }) {
  const inMonths = investments.filter(i => months.includes(monthOf(i.date)));
  const N = months.length;
  const total = sum(inMonths, i => i.amount);
  const byMonth = new Map(months.map(m => [m, 0]));
  for (const i of inMonths) byMonth.set(monthOf(i.date), byMonth.get(monthOf(i.date)) + i.amount);
  const missed = months.filter(m => !inMonths.some(i => monthOf(i.date) === m));
  const recKnown = recommended.filter(r => r && months.includes(r.month));
  const totalRecommended = sum(recKnown, r => r.amount);
  const avg = N ? total / N : 0;
  return {
    N, total, avg,
    gap: avg - budget, gapPct: budget ? avg / budget - 1 : 0,
    reserve: budget * N - total,
    missed,
    totalRecommended,
    avgRecommended: recKnown.length ? totalRecommended / recKnown.length : null,
    recommendedMonths: recKnown.length,
    byMonth,
  };
}

/** Frais : total, % du total investi, moyenne par investissement. */
export function feeStats(investments) {
  const n = investments.length;
  const total = sum(investments, i => i.fees || 0);
  const invested = sum(investments, i => i.amount);
  return { total, pct: invested ? total / invested : 0, avg: n ? total / n : 0, count: n };
}

/**
 * Performance à la date du dernier relevé de valeur : plus-value, rendement simple et TRI (XIRR),
 * nets de frais. Seules les saisies jusqu'à la date du relevé comptent.
 */
export function performance(investments, valuations) {
  const last = [...valuations].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!last) return null;
  const upTo = investments.filter(i => i.date <= last.date);
  if (!upTo.length) return null;
  const invested = sum(upTo, i => i.amount), fees = sum(upTo, i => i.fees || 0);
  const gain = last.value - invested - fees;
  const flows = [...upTo.map(i => ({ date: i.date, amount: -(i.amount + (i.fees || 0)) })), { date: last.date, amount: last.value }];
  const first = upTo.map(i => i.date).sort()[0];
  return {
    date: last.date, value: last.value, invested, fees, gain,
    simple: gain / (invested + fees),
    xirr: xirr(flows),
    shortHistory: (toMs(last.date) - toMs(first)) / DAY_MS < 365,
  };
}

// ---------- TRI (XIRR), convention Excel : année de 365 jours ----------

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

// ---------- Simulation sur l'indice (comparaison des DCA) ----------

/**
 * Simule l'achat de l'indice : chaque versement achète des « parts » à la première clôture à partir de sa date,
 * le tout est valorisé à la dernière clôture. En USD, hors dividendes, frais et change.
 * Les versements postérieurs à la dernière clôture sont ignorés (comptés dans `pending`).
 */
export function simulateDca(peaked, flows) {
  const lastP = peaked.at(-1);
  let units = 0, invested = 0, pending = 0;
  const used = [];
  for (const f of flows) {
    if (!(f.amount > 0)) continue;
    const i = lastIndexBefore(peaked, f.date) + 1; // première clôture le jour même ou après
    if (i >= peaked.length || i < 0) { pending++; continue; }
    units += f.amount / peaked[i].close;
    invested += f.amount;
    used.push({ date: peaked[i].date, amount: f.amount });
  }
  const value = units * lastP.close;
  return {
    invested, value, gain: value - invested,
    simple: invested ? value / invested - 1 : null,
    xirr: used.length ? xirr([...used.map(u => ({ date: u.date, amount: -u.amount })), { date: lastP.date, amount: value }]) : null,
    valueDate: lastP.date, count: used.length, pending,
  };
}

/** Les trois DCA comparés sur la même période : réel, optimisé (modèle) et classique (B chaque mois). */
export function compareDca({ peaked, months, investments, recommended, budget, day }) {
  const real = investments.filter(i => months.includes(monthOf(i.date))).map(i => ({ date: i.date, amount: i.amount }));
  const optimized = recommended.filter(r => r && months.includes(r.month)).map(r => ({ date: r.investDate, amount: r.amount }));
  const classic = months.map(m => ({ date: investDateOf(m, day), amount: budget }));
  return {
    real: simulateDca(peaked, real),
    optimized: simulateDca(peaked, optimized),
    classic: simulateDca(peaked, classic),
  };
}

// ---------- Sauvegarde : export / import JSON ----------

export const EXPORT_APP = 'dca-optimise';
export const EXPORT_VERSION = 1;

/** Texte JSON de sauvegarde (préférences + suivi). */
export function exportData({ prefs, suivi }, now = new Date()) {
  return JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: now.toISOString(), prefs, suivi }, null, 2);
}

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toMs(s));
const isMoney = v => typeof v === 'number' && isFinite(v) && v >= 0;

/** Lit et vérifie une sauvegarde. Lève une erreur claire si le fichier n'est pas valide. */
export function importData(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error("ce fichier n'est pas une sauvegarde (JSON illisible)"); }
  if (d?.app !== EXPORT_APP) throw new Error("ce fichier n'est pas une sauvegarde de DCA optimisé");
  if (d.version !== EXPORT_VERSION) throw new Error(`version de sauvegarde inconnue (${d.version})`);
  const s = d.suivi ?? {};
  if (s.startDate != null && !isDate(s.startDate)) throw new Error('date de départ invalide');
  for (const i of s.investments ?? []) {
    if (!i.id || !isDate(i.date) || !isMoney(i.amount) || !isMoney(i.fees ?? 0)) throw new Error(`investissement invalide (${JSON.stringify(i)})`);
  }
  for (const v of s.valuations ?? []) {
    if (!v.id || !isDate(v.date) || !isMoney(v.value)) throw new Error(`relevé invalide (${JSON.stringify(v)})`);
  }
  return { prefs: d.prefs ?? {}, suivi: { startDate: s.startDate ?? null, investments: s.investments ?? [], valuations: s.valuations ?? [] } };
}
