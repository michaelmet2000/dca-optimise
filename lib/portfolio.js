// Portefeuille de chaque personne : ses produits (ETF…) et leur pourcentage cible.
// Le drawdown, lui, reste toujours calculé sur l'indice de référence : le portefeuille ne sert qu'à répartir
// le montant du mois et à suivre chaque produit (saisies, valeur, performance).
import { xirr } from './xirr.js';

export const MAX_PRODUCTS = 8;
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
const round2 = v => Math.round(v * 100) / 100;

/** Nom de produit affichable : court, sans caractères de contrôle ni séparateurs du lien. */
export const cleanProductName = s => String(s ?? '').replace(/[\u0000-\u001f<>:,]/g, '').trim().slice(0, 20);

/** Vérifie une liste de produits. Renvoie un message d'erreur, ou null si tout est correct. */
export function validateProducts(products) {
  if (!Array.isArray(products) || !products.length) return 'Ajoute au moins un produit.';
  if (products.length > MAX_PRODUCTS) return `${MAX_PRODUCTS} produits au maximum.`;
  const names = products.map(p => cleanProductName(p.name).toLowerCase());
  if (names.some(n => !n)) return 'Chaque produit doit avoir un nom.';
  if (new Set(names).size !== names.length) return 'Deux produits portent le même nom.';
  if (products.some(p => !(typeof p.pct === 'number' && p.pct > 0 && p.pct <= 100))) return 'Chaque pourcentage doit être entre 0 et 100.';
  const total = sum(products, p => p.pct);
  if (Math.abs(total - 100) > 0.001) return `Le total doit faire 100 % (actuellement ${round2(total)} %).`;
  return null;
}

/** Paramètre de lien "SPYI:90,EIMI:10" -> [{name, pct}], ou null s'il est absent ou invalide. */
export function parsePortfolioParam(s) {
  if (!s) return null;
  const products = String(s).split(',').map(part => {
    const i = part.lastIndexOf(':');
    return { name: cleanProductName(part.slice(0, i)), pct: Number(part.slice(i + 1).replace(',', '.')) };
  });
  return validateProducts(products) ? null : products;
}

/** [{name, pct}] -> "SPYI:90,EIMI:10" (à encoder dans l'URL). */
export const portfolioParam = products => products.map(p => `${cleanProductName(p.name)}:${p.pct}`).join(',');

/**
 * Répartit un montant selon les pourcentages cibles. Arrondi au franc si le montant est entier (sinon au
 * centime), avec la méthode du plus fort reste : la somme des parts est toujours exactement le montant.
 * @returns {{productId:string, amount:number}[]}
 */
export function splitAmount(total, products) {
  if (!products.length) return [];
  const unit = Number.isInteger(total) ? 1 : 0.01;
  const units = Math.round(total / unit);
  const raw = products.map(p => units * p.pct / 100);
  const parts = raw.map(Math.floor);
  let rest = units - sum(parts);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => { if (rest > 0) { parts[i]++; rest--; } });
  return products.map((p, i) => ({ productId: p.id, amount: round2(parts[i] * unit) }));
}

// ---------- Saisies : investissements et relevés répartis par produit ----------

/** Montant total d'un investissement (somme de ses lignes). */
export const investmentTotal = inv => round2(sum(inv.lines ?? [], l => l.amount));
/** Valeur totale d'un relevé (somme de ses lignes). */
export const valuationTotal = val => round2(sum(val.lines ?? [], l => l.value));

/** Investissements « à plat » {id, date, amount, fees, note} pour les indicateurs globaux. */
export const flatInvestments = suivi => suivi.investments.map(i => ({ id: i.id, date: i.date, amount: investmentTotal(i), fees: i.fees || 0, note: i.note ?? '' }));
/** Relevés « à plat » {id, date, value}. */
export const flatValuations = suivi => suivi.valuations.map(v => ({ id: v.id, date: v.date, value: valuationTotal(v) }));

/**
 * Convertit un suivi de l'ancien format (un seul montant par saisie, sans produits) au format par produit.
 * Les anciennes saisies sont rattachées au premier produit.
 */
export function migrateSuivi(s) {
  const products = Array.isArray(s?.products) && s.products.length ? s.products : [{ id: 'p1', name: 'Mon ETF', pct: 100 }];
  const first = products[0].id;
  return {
    startDate: s?.startDate ?? null,
    products,
    investments: (s?.investments ?? []).map(i => i.lines ? i
      : { id: i.id, date: i.date, fees: i.fees || 0, note: i.note ?? '', lines: [{ productId: first, amount: i.amount }] }),
    valuations: (s?.valuations ?? []).map(v => v.lines ? v : { id: v.id, date: v.date, lines: [{ productId: first, value: v.value }] }),
  };
}

/**
 * Performance de chaque produit à la date de son dernier relevé : investi, part des frais (au prorata du
 * montant de chaque ligne), valeur, plus-value, rendement simple, TRI, poids réel et poids cible.
 */
export function productPerformance(suivi) {
  const lastVal = [...suivi.valuations].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const totalValue = lastVal ? valuationTotal(lastVal) : 0;
  return suivi.products.map(p => {
    const val = [...suivi.valuations].filter(v => v.lines.some(l => l.productId === p.id))
      .sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const flows = [];
    let invested = 0, fees = 0;
    for (const i of suivi.investments) {
      const line = i.lines.find(l => l.productId === p.id);
      if (!line || !(line.amount > 0) || (val && i.date > val.date)) continue;
      const total = investmentTotal(i);
      const feeShare = total ? (i.fees || 0) * line.amount / total : 0;
      invested += line.amount; fees += feeShare;
      flows.push({ date: i.date, amount: -(line.amount + feeShare) });
    }
    const value = val ? val.lines.find(l => l.productId === p.id).value : null;
    const lastLineValue = lastVal?.lines.find(l => l.productId === p.id)?.value ?? 0;
    return {
      productId: p.id, name: p.name, targetPct: p.pct,
      invested: round2(invested), fees: round2(fees), value, valueDate: val?.date ?? null,
      gain: value == null ? null : round2(value - invested - fees),
      simple: value == null || !(invested + fees) ? null : (value - invested - fees) / (invested + fees),
      xirr: value == null || !flows.length ? null : xirr([...flows, { date: val.date, amount: value }]),
      weight: totalValue ? lastLineValue / totalValue : null, // poids réel au dernier relevé
    };
  });
}
