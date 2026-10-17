// Tests d'acceptation des règles métier (cahier des charges, section 8).
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  tierIndex, scaledAmount, tierStats, monthlyStatsMminus1, dailyTierStats, drawdownSeries, tierLabels,
  withPeaks, monthSituation, investDateOf, previousWeekday, dailyFreshness, isWeekend, addMonths, lastWeekdayOfMonth,
} from '../lib/model.js';
import { parseClosesCsv, parseDailyCsv } from '../lib/parse.js';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = p => fs.existsSync(new URL('../' + p, import.meta.url));
const config = JSON.parse(read('config.json'));
const IDX = config.indices.msciworld;
const TIERS = IDX.tiers;
const PRIOR = IDX.priorPeak;
const amountFor = dd => TIERS[tierIndex(dd, TIERS)].amount;
const pct = s => s.freq.map(f => Math.round(f * 1000) / 10);

// ---------- Test 1 : méthode journalière (celle de l'application) ----------
const INVESTING = 'data/historique/MSCI_World_Historical_Data.csv';

test('1. Méthode journalière, MSCI World (investing.com), jour 25, 08/2012–10/2026', () => {
  const points = parseDailyCsv(read(INVESTING));
  assert.equal(PRIOR.close, 1682.351441);
  const s = dailyTierStats(points, TIERS, PRIOR, '2012-08', '2026-10', 25);
  assert.equal(s.n, 171);
  assert.deepEqual(s.counts, [99, 27, 37, 8, 0]);
  assert.deepEqual(pct(s), [57.9, 15.8, 21.6, 4.7, 0.0]);
  assert.equal(s.mean.toFixed(1), '965.0');
});

test('1b. Plus haute clôture du fichier = 5 034,04 le 13/08/2026', () => {
  const peaked = withPeaks(parseDailyCsv(read(INVESTING)), PRIOR);
  assert.equal(peaked.at(-1).peak, 5034.04);
  assert.equal(peaked.at(-1).peakDate, '2026-08-13');
});

test("1c. L'historique du repo (dimanches investing.com écartés) donne le même résultat, et n'a aucun week-end", () => {
  const points = parseDailyCsv(read(IDX.historyFile));
  assert.ok(points.every(p => !isWeekend(p.date)));
  const s = dailyTierStats(points.filter(p => p.date <= '2026-10-16'), TIERS, PRIOR, '2012-08', '2026-10', 25);
  assert.deepEqual(s.counts, [99, 27, 37, 8, 0]);
});

// ---------- Test 2 : calibration mensuelle MSCI World (fichier msci.com fourni par l'utilisateur) ----------
const MSCI_MONTHLY = 'data/historique/MSCI_World_Price_mensuel_1997-2026.csv';
test('2. Mensuel M−1, MSCI World Price 02/1997–09/2026 : ≈ 1 366 CHF', { skip: !exists(MSCI_MONTHLY) && `${MSCI_MONTHLY} absent` }, () => {
  const monthly = parseClosesCsv(read(MSCI_MONTHLY));
  const s = monthlyStatsMminus1(monthly, TIERS, '1997-02', '2026-09');
  assert.equal(s.n, 356);
  assert.deepEqual(pct(s), [43.8, 12.9, 14.3, 15.4, 13.5]);
  assert.ok(Math.abs(s.mean - 1366) < 1, `moyenne ${s.mean}`);
});

// ---------- Test 3 : calibration d'origine S&P 500 ----------
// Clôtures de 02/1970 à 12/2024 (règle M−1 : montants de 03/1970 à 01/2025), plus haut depuis 02/1970.
// Valeurs du cahier des charges : 48,3 / 13,1 / 20,5 / 11,4 / 6,8 % et ≈ 1 207. Elles venaient d'un calcul en
// virgule flottante brute où 11/1979 (106,20 / 118,00 = −10,000 % exactement) tombait dans le palier 940.
// Règle exacte validée par l'utilisateur (−10,00 % -> 1 500) : 85 mois au lieu de 86, 136 au lieu de 135.
const SP500 = exists('data/historique/SP_500_Donnees_Historiques.csv')
  ? 'data/historique/SP_500_Donnees_Historiques.csv' : 'data/historique/sp500_mensuel_investing.csv';

test('3. S&P 500 mensuel 02/1970–12/2024 : ≈ 1 207 CHF', () => {
  const monthly = parseClosesCsv(read(SP500));
  assert.equal(monthly[0].month, '1970-02', "l'historique commence en 02/1970");
  const s = tierStats(monthly, TIERS, '1970-02', '2024-12');
  assert.equal(s.n, 659);
  assert.deepEqual(s.counts, [318, 85, 136, 75, 45]);
  assert.deepEqual(pct(s), [48.3, 12.9, 20.6, 11.4, 6.8]);
  assert.equal(s.mean.toFixed(2), '1207.94');
});

test('3b. Le seul mois S&P sur une borne exacte est 11/1979 (−10,00 %) -> palier 1 500', () => {
  const p = drawdownSeries(parseClosesCsv(read(SP500))).find(x => x.month === '1979-11');
  assert.equal(p.close, 106.2);
  assert.equal(p.ath, 118);
  assert.equal(p.dd, -0.1);
  assert.equal(amountFor(p.dd), 1500);
});

// ---------- Bornes et mise à l'échelle ----------
test('4. Bornes des paliers', () => {
  assert.equal(amountFor(-0.0499), 660);
  assert.equal(amountFor(-0.05), 940);    // −5,00 % exactement -> 940
  assert.equal(amountFor(-0.10), 1500);   // −10,00 % -> 1 500
  assert.equal(amountFor(-0.1999), 1500);
  assert.equal(amountFor(-0.20), 2350);
  assert.equal(amountFor(-0.30), 2800);
  assert.equal(amountFor(-0.45), 2800);
  assert.equal(amountFor(0), 660);
});

test('4b. DD calculé depuis des clôtures exactement à une borne (pas d\'erreur de virgule flottante)', () => {
  const s = drawdownSeries([100, 95, 90, 80, 70].map((close, i) => ({ month: `2000-0${i + 1}`, close })));
  assert.deepEqual(s.map(p => amountFor(p.dd)), [660, 940, 1500, 2350, 2800]);
});

test('5. Mise à l\'échelle du budget, arrondi aux 10 CHF', () => {
  const scaleAll = B => TIERS.map(t => scaledAmount(t.amount, B, 1200, 10));
  assert.deepEqual(scaleAll(1200), [660, 940, 1500, 2350, 2800]);
  assert.deepEqual(scaleAll(600), [330, 470, 750, 1180, 1400]);   // 1 175 -> 1 180 (moitié vers le haut)
  assert.deepEqual(scaleAll(2000), [1100, 1570, 2500, 3920, 4670]); // 1 566,67 ; 3 916,67 ; 4 666,67
  assert.equal(scaledAmount(amountFor(-0.12), 600), 750);          // exemple du cahier des charges
});

test('Libellés des paliers', () => {
  assert.deepEqual(tierLabels(TIERS), ['DD > −5 %', '−10 % < DD ≤ −5 %', '−20 % < DD ≤ −10 %', '−30 % < DD ≤ −20 %', 'DD ≤ −30 %']);
});

// ---------- Jour d'investissement et clôture J−1 ----------
test('Jour d\'investissement 31 en février -> dernier jour de février (bissextile ou non)', () => {
  assert.equal(investDateOf('2026-02', 31), '2026-02-28');
  assert.equal(investDateOf('2028-02', 31), '2028-02-29');
  assert.equal(investDateOf('2100-02', 30), '2100-02-28'); // 2100 n'est pas bissextile
  assert.equal(investDateOf('2026-04', 31), '2026-04-30');
  assert.equal(investDateOf('2026-10', 25), '2026-10-25');
});

const SERIES = withPeaks([
  { date: '2026-10-13', close: 100 }, { date: '2026-10-14', close: 96 }, { date: '2026-10-15', close: 94 },
  { date: '2026-10-16', close: 90 }, { date: '2026-10-19', close: 89 },
], null);

test('Estimation avant le jour J : dernière clôture strictement avant aujourd\'hui', () => {
  const s = monthSituation(SERIES, '2026-10-17', 25); // samedi
  assert.equal(s.mode, 'estimate');
  assert.equal(s.investDate, '2026-10-25');
  assert.equal(s.point.date, '2026-10-16');
  assert.equal(amountFor(s.point.dd), 1500); // −10 %
});

test('Montant figé à partir du jour J : dernière clôture strictement avant J', () => {
  const s = monthSituation(SERIES, '2026-10-20', 15);
  assert.equal(s.mode, 'fixed');
  assert.equal(s.point.date, '2026-10-14');   // la clôture DU 15 n'est pas utilisée
  assert.equal(amountFor(s.point.dd), 660);   // −4 %
  assert.equal(s.complete, true);
  // le jour J lui-même : toujours la veille
  assert.equal(monthSituation(SERIES, '2026-10-15', 15).point.date, '2026-10-14');
  // J tombe un lundi -> clôture du vendredi
  assert.equal(monthSituation(SERIES, '2026-10-19', 19).point.date, '2026-10-16');
  // J = 1 -> dernière clôture du mois précédent
  assert.equal(monthSituation(withPeaks([{ date: '2026-09-30', close: 50 }, { date: '2026-10-01', close: 60 }]), '2026-10-05', 1).point.date, '2026-09-30');
});

test('Montant figé mais données pas encore à jour -> complete = false', () => {
  const s = monthSituation(SERIES, '2026-10-28', 25); // il faudrait la clôture du 23/10, la série s'arrête au 19
  assert.equal(s.mode, 'fixed');
  assert.equal(s.complete, false);
});

test('Le pic injecté compte tant que la série ne le dépasse pas', () => {
  const p = withPeaks([{ date: '2012-07-09', close: 1224.14 }], { date: '2007-10-31', close: 1682.351441 });
  assert.equal(p[0].peak, 1682.351441);
  assert.equal(p[0].peakDate, '2007-10-31');
  assert.equal(p[0].dd, Math.round((1224.14 / 1682.351441 - 1) * 1e9) / 1e9);
});

test('Fraîcheur des données journalières (un jour ouvré de décalage toléré)', () => {
  assert.equal(previousWeekday('2026-10-19'), '2026-10-16');
  assert.equal(dailyFreshness('2026-10-16', '2026-10-17'), 'ok');  // samedi
  assert.equal(dailyFreshness('2026-10-16', '2026-10-19'), 'ok');  // lundi matin
  assert.equal(dailyFreshness('2026-10-16', '2026-10-20'), 'ok');  // mardi : clôture de lundi pas encore là
  assert.equal(dailyFreshness('2026-10-16', '2026-10-21'), 'late');
});

test('Calcul des mois', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(lastWeekdayOfMonth('2026-05'), '2026-05-29');
});
