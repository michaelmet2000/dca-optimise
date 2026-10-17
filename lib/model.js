// Règles métier du DCA optimisé. Module partagé : navigateur, job de mise à jour et tests.
// Aucune dépendance, aucun accès au DOM ni au système de fichiers.

/**
 * DD = clôture / plus haut − 1, débarrassé du bruit de la virgule flottante.
 * Sans cela, 106,20 / 118,00 − 1 vaut −0,09999999999999998 et tomberait à tort dans le palier > −10 %.
 * L'arrondi à 1e-9 (un cent-millionième de %) ne change aucun autre mois.
 */
export const drawdown = (close, ath) => Math.round((close / ath - 1) * 1e9) / 1e9;

/**
 * Série mensuelle -> drawdown de chaque mois.
 * DD = clôture / max(toutes les clôtures jusqu'à ce mois inclus) − 1.
 * @param {{month:string, date?:string, close:number}[]} monthly triée par mois croissant
 */
export function drawdownSeries(monthly) {
  let ath = -Infinity, athDate = null, athMonth = null;
  return monthly.map(p => {
    if (p.close > ath) { ath = p.close; athDate = p.date ?? null; athMonth = p.month; }
    return { ...p, ath, athDate, athMonth, dd: drawdown(p.close, ath) };
  });
}

/**
 * Index du palier pour un DD. Les paliers sont lus dans l'ordre :
 * le premier dont `above` est strictement inférieur au DD s'applique (DD > above).
 * Une borne exacte tombe donc dans le palier suivant : −5,00 % -> palier 2 (940).
 */
export function tierIndex(dd, tiers) {
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].above === null || dd > tiers[i].above) return i;
  }
  return tiers.length - 1;
}

/**
 * Montant personnalisé : base × B / budget nominal, arrondi au multiple de `roundTo` le plus proche
 * (une moitié exacte est arrondie vers le haut). Calcul en entiers pour éviter les erreurs de virgule flottante.
 */
export function scaledAmount(baseAmount, budget, nominalBudget = 1200, roundTo = 10) {
  const num = baseAmount * budget;            // entier si budget entier
  const den = nominalBudget * roundTo;
  return Math.floor((2 * num + den) / (2 * den)) * roundTo;
}

/** Libellés des paliers, ex. « −10 % < DD ≤ −5 % ». */
export function tierLabels(tiers) {
  const p = x => `−${Math.round(-x * 100)} %`;
  return tiers.map((t, i) => {
    const prev = i > 0 ? tiers[i - 1].above : null;
    if (i === 0) return `DD > ${p(t.above)}`;
    if (t.above === null) return `DD ≤ ${p(prev)}`;
    return `${p(t.above)} < DD ≤ ${p(prev)}`;
  });
}

/**
 * Statistiques de calibration sur une période : fréquence de chaque palier et montant moyen.
 * Le plus haut historique se calcule depuis le début de `monthly` (pas seulement depuis `from`).
 */
export function tierStats(monthly, tiers, from = '0000-00', to = '9999-99') {
  const counts = tiers.map(() => 0);
  let n = 0, sum = 0;
  for (const p of drawdownSeries(monthly)) {
    if (p.month < from || p.month > to) continue;
    const i = tierIndex(p.dd, tiers);
    counts[i]++; n++; sum += tiers[i].amount;
  }
  return { n, counts, freq: counts.map(c => c / n), mean: sum / n };
}

/**
 * Calibration mensuelle avec la règle « montant du mois M = DD à la clôture de M−1 » :
 * les montants des mois `fromMonth`..`toMonth` utilisent les clôtures de `fromMonth−1`..`toMonth−1`.
 */
export function monthlyStatsMminus1(monthly, tiers, fromMonth, toMonth) {
  return tierStats(monthly, tiers, addMonths(fromMonth, -1), addMonths(toMonth, -1));
}

// ---------- Méthode journalière (celle de l'application) ----------
// DD = clôture(J−1) / max(toutes les clôtures journalières jusqu'à J−1 inclus) − 1,
// où J−1 est le dernier jour de bourse STRICTEMENT avant le jour d'investissement J.
// Un « jour de bourse » est un jour présent dans la série de l'indice.

/**
 * Ajoute à chaque point le pic courant (plus haute clôture jusqu'à ce jour inclus).
 * `priorPeak` = {date, close} : plus haute clôture antérieure au début de la série (null si aucune).
 */
export function withPeaks(points, priorPeak = null) {
  let peak = priorPeak ? priorPeak.close : -Infinity, peakDate = priorPeak ? priorPeak.date : null;
  return points.map(p => {
    if (p.close > peak) { peak = p.close; peakDate = p.date; }
    return { date: p.date, close: p.close, peak, peakDate, dd: drawdown(p.close, peak) };
  });
}

/** Index du dernier point dont la date est strictement avant `dateIso` (−1 si aucun). Recherche dichotomique. */
export function lastIndexBefore(points, dateIso) {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date < dateIso) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Date d'investissement du mois : jour J, ou dernier jour du mois s'il est plus court (31 -> 28/29 février). */
export function investDateOf(month, day) {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;
}

/** Point (avec pic et DD) utilisé pour un investissement à la date `dateIso`, ou null si pas de donnée avant. */
export function pointBefore(peaked, dateIso) {
  const i = lastIndexBefore(peaked, dateIso);
  return i < 0 ? null : peaked[i];
}

/**
 * Situation du mois en cours pour un utilisateur investissant le jour `investDay`.
 *  - avant la date d'investissement : « estimation si tu investissais aujourd'hui » (dernière clôture avant aujourd'hui) ;
 *  - à partir de cette date : montant figé du mois (dernière clôture avant la date d'investissement).
 * `complete` = false si la clôture attendue n'est peut-être pas encore dans les données.
 */
export function monthSituation(peaked, todayIso, investDay) {
  const investDate = investDateOf(monthOf(todayIso), investDay);
  const mode = todayIso < investDate ? 'estimate' : 'fixed';
  const point = pointBefore(peaked, mode === 'estimate' ? todayIso : investDate);
  const lastDate = peaked.at(-1)?.date ?? '';
  const complete = mode === 'fixed' ? lastDate >= previousWeekday(investDate) : true;
  return { mode, investDate, point, complete };
}

/**
 * Calibration avec la méthode journalière : pour chaque mois de `fromMonth` à `toMonth`, DD à la dernière
 * clôture strictement avant le jour `investDay`. Renvoie fréquences et montant moyen comme `tierStats`.
 */
export function dailyTierStats(points, tiers, priorPeak, fromMonth, toMonth, investDay) {
  const peaked = withPeaks(points, priorPeak);
  const counts = tiers.map(() => 0);
  let n = 0, sum = 0;
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
    const p = pointBefore(peaked, investDateOf(m, investDay));
    if (!p) throw new Error(`Aucune clôture avant le ${investDateOf(m, investDay)}`);
    const i = tierIndex(p.dd, tiers);
    counts[i]++; n++; sum += tiers[i].amount;
  }
  return { n, counts, freq: counts.map(c => c / n), mean: sum / n };
}

/** DD à la dernière clôture de chaque mois, pour les `count` derniers mois (graphique). */
export function monthEndDrawdowns(peaked, count = 121) {
  const byMonth = new Map();
  for (const p of peaked) byMonth.set(monthOf(p.date), p);
  return [...byMonth.entries()].slice(-count).map(([m, p]) => [m, p.dd]);
}

/** Jour ouvré (lun–ven) précédent, strictement avant `dateIso`. */
export function previousWeekday(dateIso) {
  const d = new Date(dateIso + 'T00:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

export const isWeekend = dateIso => [0, 6].includes(new Date(dateIso + 'T00:00:00Z').getUTCDay());

/**
 * Fraîcheur des données journalières : la clôture d'un jour est publiée dans la nuit ou le lendemain matin.
 * On tolère donc un jour ouvré de décalage : « late » si la dernière clôture est antérieure à l'avant-veille ouvrée.
 */
export function dailyFreshness(lastDate, todayIso) {
  const limit = previousWeekday(previousWeekday(todayIso));
  return lastDate >= limit ? 'ok' : 'late';
}

// ---------- Dates et mois (chaînes "AAAA-MM" et "AAAA-MM-JJ", sans fuseau horaire) ----------

export const monthOf = date => date.slice(0, 7);

export function addMonths(month, k) {
  let [y, m] = month.split('-').map(Number);
  m += k;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dernier jour ouvré (lun–ven) du mois — sert seulement quand la vraie date de clôture est inconnue. */
export function lastWeekdayOfMonth(month) {
  let d = daysInMonth(month);
  const [y, m] = month.split('-').map(Number);
  while ([0, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) d--;
  return `${month}-${String(d).padStart(2, '0')}`;
}
