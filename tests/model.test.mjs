// Tests d'acceptation des règles métier (cahier des charges, section 8).
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  tierIndex, scaledAmount, monthlyStatsMminus1, dailyTierStats, drawdownSeries, tierLabels,
  withPeaks, pointBefore, monthSituation, peakCoveredByHistory, investDateOf, previousWeekday, dailyFreshness, isWeekend, addMonths, lastWeekdayOfMonth,
} from '../lib/model.js';
import { parseClosesCsv, parseDailyCsv } from '../lib/parse.js';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = p => fs.existsSync(new URL('../' + p, import.meta.url));
const config = JSON.parse(read('config.json'));
const IDX = config.indices.acwiimi;
const TIERS = IDX.tiers;
const amountFor = dd => TIERS[tierIndex(dd, TIERS)].amount;
const pct = s => s.freq.map(f => Math.round(f * 1000) / 10);

test('Paliers de la config = paliers du cahier des charges (400 / 940 / 2 000 / 2 800 / 3 500)', () => {
  assert.equal(config.activeIndex, 'acwiimi');
  assert.deepEqual(TIERS.map(t => [t.above, t.amount]), [[-0.05, 400], [-0.10, 940], [-0.20, 2000], [-0.30, 2800], [null, 3500]]);
  assert.equal(IDX.level, 'Price');
  assert.equal(IDX.priorPeak, null); // l'historique couvre 2007 : plus de pic injecté
});

// ---------- Test 1 : méthode journalière (celle de l'application), MSCI ACWI IMI Price ----------
// Historique = exports journaliers msci.com importés dans data/history/acwiimi.csv.
// Les tests 1 à 1c exigent l'historique complet depuis le 01/01/1997 ; sinon ils sont sautés.
const HAS_DAILY = exists(IDX.historyFile) && parseDailyCsv(read(IDX.historyFile))[0].date === '1997-01-01';
const dailyUntil = () => parseDailyCsv(read(IDX.historyFile)).filter(p => p.date <= '2026-10-16');

test('1. Méthode journalière, jour 25, 02/1997–10/2026 : 1 543,7 CHF', { skip: !HAS_DAILY && "historique journalier complet (depuis le 01/01/1997) absent" }, () => {
  const points = dailyUntil();
  assert.equal(points[0].date, '1997-01-01');
  const s = dailyTierStats(points, TIERS, null, '1997-02', '2026-10', 25);
  assert.equal(s.n, 357);
  assert.deepEqual(pct(s), [38.9, 14.0, 20.2, 12.6, 14.3]);
  assert.equal(s.mean.toFixed(1), '1543.7');
});

test('1b. Points de contrôle (jour 25) et repères de la série', { skip: !HAS_DAILY && "historique journalier complet (depuis le 01/01/1997) absent" }, () => {
  const peaked = withPeaks(dailyUntil(), null);
  const at = date => peaked.find(p => p.date === date);
  assert.equal(at('2026-10-16').close.toFixed(2), '2813.72');
  assert.equal(peaked.at(-1).peak.toFixed(2), '2903.74');
  assert.equal(peaked.at(-1).peakDate, '2026-08-14');
  assert.equal(at('2007-10-31').peak.toFixed(2), '1060.07');
  const expected = [
    ['2008-10', '2008-10-24', '525.74', '1060.07', '-50.41', 3500],
    ['2009-03', '2009-03-24', '509.99', '1060.07', '-51.89', 3500],
    ['2020-04', '2020-04-24', '1186.55', '1474.25', '-19.52', 2000],
    ['2022-10', '2022-10-24', '1456.24', '1936.44', '-24.80', 2800],
    ['2026-10', '2026-10-16', '2813.72', '2903.74', '-3.10', 400],
  ];
  for (const [month, date, close, peak, dd, amount] of expected) {
    const p = pointBefore(peaked, investDateOf(month, 25));
    assert.deepEqual([p.date, p.close.toFixed(2), p.peak.toFixed(2), (p.dd * 100).toFixed(2), amountFor(p.dd)], [date, close, peak, dd, amount], month);
  }
});

test('1c. Capacité à prévoir : 2,92 × B sur 2 ans (09/2001–08/2003), ≈ 2,3 à 2,4 × B sur 5–6 ans', { skip: !HAS_DAILY && "historique journalier complet (depuis le 01/01/1997) absent" }, () => {
  const peaked = withPeaks(dailyUntil(), null);
  const amounts = [];
  for (let m = '1997-02'; m <= '2026-10'; m = addMonths(m, 1)) amounts.push([m, amountFor(pointBefore(peaked, investDateOf(m, 25)).dd)]);
  const avg = (a, b) => { const s = amounts.filter(([m]) => m >= a && m <= b); return s.reduce((x, [, v]) => x + v, 0) / s.length / 1200; };
  let best = 0, at = '';
  for (let i = 0; i + 24 <= amounts.length; i++) {
    const v = amounts.slice(i, i + 24).reduce((x, [, a]) => x + a, 0) / 24 / 1200;
    if (v > best) { best = v; at = amounts[i][0]; }
  }
  const c = config.capacity;
  assert.equal(best.toFixed(2), c.peakMultiple.toFixed(2));
  assert.equal(at, '2001-09');
  for (const [a, b] of [['2000-11', '2005-11'], ['2008-02', '2013-09']]) {
    const v = avg(a, b);
    assert.ok(v >= c.longMultipleMin - 0.05 && v <= c.longMultipleMax + 0.05, `${a}–${b} : ${v.toFixed(2)} × B`);
  }
});

// ---------- Test 2 : calibration mensuelle MSCI ACWI IMI (fichier msci.com fourni) ----------
test('2. Mensuel M−1, MSCI ACWI IMI Price 02/1997–09/2026 : 1 472,5 CHF', () => {
  const monthly = parseClosesCsv(read('data/historique/MSCI_ACWI_IMI_Price_mensuel_1997-2026.csv'));
  assert.equal(monthly[0].close, 496.462); // 496,462 et non 496 462
  const s = monthlyStatsMminus1(monthly, TIERS, '1997-02', '2026-09');
  assert.equal(s.n, 356);
  assert.deepEqual(pct(s), [43.3, 13.5, 16.9, 12.6, 13.8]);
  assert.equal(s.mean.toFixed(1), '1472.5');
});

// ---------- Test 3 : S&P 500 mensuel, règle M−1 ----------
// Référence du cahier des charges : 1 284,4 CHF (03/1970–12/2024) et 1 268,9 CHF (03/1970–01/2026).
// Écart connu et validé par l'utilisateur : la référence vient d'un calcul en virgule flottante brute où
// 11/1979 (106,20 / 118,00 = −10,000 % exactement, montant de 12/1979) tombait dans le palier 940.
// Avec la règle exacte (−10,00 % -> 2 000) : 85 mois au lieu de 86 en −5/−10 %, 136 au lieu de 135 en −10/−20 %.
const SP500 = exists('data/historique/SP_500_Donnees_Historiques.csv')
  ? 'data/historique/SP_500_Donnees_Historiques.csv' : 'data/historique/sp500_mensuel_investing.csv';

test('3. S&P 500 mensuel M−1, 03/1970–12/2024 (règle exacte : 1 286,02 ; référence brute 1 284,4)', () => {
  const monthly = parseClosesCsv(read(SP500));
  const s = monthlyStatsMminus1(monthly, TIERS, '1970-03', '2024-12');
  assert.equal(s.n, 658);
  assert.deepEqual(s.counts, [317, 85, 136, 75, 45]);
  assert.equal(s.mean.toFixed(2), '1286.02');
  // la seule différence avec la référence est 11/1979 : (2 000 − 940) / 658 = 1,61 CHF
  assert.equal((s.mean - (2000 - 940) / 658).toFixed(1), '1284.4');
});

test('3b. S&P 500 mensuel M−1, 03/1970–01/2026 (règle exacte : 1 270,46 ; référence brute 1 268,9)', () => {
  const s = monthlyStatsMminus1(parseClosesCsv(read(SP500)), TIERS, '1970-03', '2026-01');
  assert.equal(s.n, 671);
  assert.equal(s.mean.toFixed(2), '1270.46');
  assert.equal((s.mean - (2000 - 940) / 671).toFixed(1), '1268.9');
});

test('3c. 11/1979 est exactement à −10,00 % -> palier 2 000', () => {
  const p = drawdownSeries(parseClosesCsv(read(SP500))).find(x => x.month === '1979-11');
  assert.equal(p.close, 106.2);
  assert.equal(p.ath, 118);
  assert.equal(p.dd, -0.1);
  assert.equal(amountFor(p.dd), 2000);
});

// ---------- 4. Bornes ----------
test('4. Bornes des paliers', () => {
  assert.equal(amountFor(-0.0499), 400);
  assert.equal(amountFor(-0.05), 940);    // −5,00 % exactement -> 940
  assert.equal(amountFor(-0.10), 2000);   // −10,00 % -> 2 000
  assert.equal(amountFor(-0.1999), 2000);
  assert.equal(amountFor(-0.20), 2800);
  assert.equal(amountFor(-0.30), 3500);
  assert.equal(amountFor(-0.45), 3500);
  assert.equal(amountFor(0), 400);
});

test('4b. DD calculé depuis des clôtures exactement à une borne (pas d\'erreur de virgule flottante)', () => {
  const s = drawdownSeries([100, 95, 90, 80, 70].map((close, i) => ({ month: `2000-0${i + 1}`, close })));
  assert.deepEqual(s.map(p => amountFor(p.dd)), [400, 940, 2000, 2800, 3500]);
});

// ---------- 5. Mise à l'échelle ----------
test('5. Mise à l\'échelle du budget, arrondi aux 10 CHF', () => {
  const scaleAll = B => TIERS.map(t => scaledAmount(t.amount, B, 1200, 10));
  assert.deepEqual(scaleAll(1200), [400, 940, 2000, 2800, 3500]);
  assert.deepEqual(scaleAll(600), [200, 470, 1000, 1400, 1750]);
  assert.deepEqual(scaleAll(2000), [670, 1570, 3330, 4670, 5830]); // 666,67 ; 1 566,67 ; 3 333,33 ; 4 666,67 ; 5 833,33
  assert.equal(scaledAmount(amountFor(-0.12), 600), 1000);          // exemple du cahier des charges
  assert.equal(scaledAmount(940, 750), 590);                        // 587,5 -> 590 (moitié vers le haut)
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
  assert.equal(amountFor(s.point.dd), 2000); // −10 %
});

test('Montant figé à partir du jour J : dernière clôture strictement avant J', () => {
  const s = monthSituation(SERIES, '2026-10-20', 15);
  assert.equal(s.mode, 'fixed');
  assert.equal(s.point.date, '2026-10-14');   // la clôture DU 15 n'est pas utilisée
  assert.equal(amountFor(s.point.dd), 400);   // −4 %
  assert.equal(s.complete, true);
  assert.equal(monthSituation(SERIES, '2026-10-15', 15).point.date, '2026-10-14'); // le jour J lui-même : la veille
  assert.equal(monthSituation(SERIES, '2026-10-19', 19).point.date, '2026-10-16'); // J un lundi -> vendredi
  assert.equal(monthSituation(withPeaks([{ date: '2026-09-30', close: 50 }, { date: '2026-10-01', close: 60 }]), '2026-10-05', 1).point.date, '2026-09-30');
});

test('Montant figé mais données pas encore à jour -> complete = false', () => {
  const s = monthSituation(SERIES, '2026-10-28', 25); // il faudrait la clôture du 23/10, la série s'arrête au 19
  assert.equal(s.mode, 'fixed');
  assert.equal(s.complete, false);
});

test('Fraîcheur des données journalières (un jour ouvré de décalage toléré)', () => {
  assert.equal(previousWeekday('2026-10-19'), '2026-10-16');
  assert.equal(dailyFreshness('2026-10-16', '2026-10-17'), 'ok');  // samedi
  assert.equal(dailyFreshness('2026-10-16', '2026-10-19'), 'ok');  // lundi matin
  assert.equal(dailyFreshness('2026-10-16', '2026-10-20'), 'ok');  // mardi : clôture de lundi pas encore là
  assert.equal(dailyFreshness('2026-10-16', '2026-10-21'), 'late');
});

test("L'historique du repo n'a aucune date de week-end, et son plus haut est bien le plus haut absolu", { skip: !exists(IDX.historyFile) && `${IDX.historyFile} absent` }, () => {
  const points = parseDailyCsv(read(IDX.historyFile));
  assert.ok(points.every(p => !isWeekend(p.date)));
  const chk = peakCoveredByHistory(points, parseClosesCsv(read(IDX.monthlyReference)));
  assert.ok(chk.ok, `fin de mois ${chk.monthBefore} = ${chk.maxBefore}`);
});

test('Garde-fou « historique trop court »', () => {
  const monthly = [{ month: '2025-09', close: 2458 }, { month: '2026-08', close: 2873 }];
  assert.equal(peakCoveredByHistory([{ date: '2025-10-17', close: 2500 }, { date: '2026-08-14', close: 2903.74 }], monthly).ok, true);
  // un historique qui ne commencerait qu'en 2026-09 manquerait le plus haut d'août
  assert.equal(peakCoveredByHistory([{ date: '2026-09-01', close: 2850 }, { date: '2026-10-16', close: 2813 }], monthly).ok, false);
});

test('Calcul des mois', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(lastWeekdayOfMonth('2026-05'), '2026-05-29');
});
