// Test 7 (cahier des charges, section 8) : suivi personnel du DCA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackedMonths, objectiveStats, feeStats, performance, xirr, simulateDca, compareDca, recommendedFor, exportData, importData } from '../lib/tracking.js';
import { withPeaks, investDateOf, peakValidFrom } from '../lib/model.js';

const TIERS = [
  { above: -0.05, amount: 400 }, { above: -0.10, amount: 940 }, { above: -0.20, amount: 2000 },
  { above: -0.30, amount: 2800 }, { above: null, amount: 3500 },
];

test('7a. Moyenne et réserve sur 6 mois (B = 1 000 ; 400, 400, 940, 0, 2 000, 400)', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const amounts = [400, 400, 940, 0, 2000, 400];
  const investments = months.map((m, k) => ({ id: String(k), date: `${m}-25`, amount: amounts[k], fees: 0 }))
    .filter(i => i.amount > 0); // le mois à 0 = mois manqué, aucune saisie
  const s = objectiveStats({ months, investments, budget: 1000 });
  assert.equal(s.N, 6);
  assert.equal(s.total, 4140);
  assert.equal(s.avg.toFixed(2), '690.00');
  assert.equal(s.reserve, 1860);
  assert.deepEqual(s.missed, ['2026-04']);
  assert.equal(s.gap.toFixed(2), '-310.00');
  assert.equal((s.gapPct * 100).toFixed(1), '-31.0');
});

test('7b. Jour d\'investissement 31 en février -> dernier jour de février', () => {
  assert.equal(investDateOf('2026-02', 31), '2026-02-28'); // non bissextile
  assert.equal(investDateOf('2028-02', 31), '2028-02-29'); // bissextile
  assert.equal(investDateOf('2024-02', 31), '2024-02-29');
});

test('7c. XIRR vérifiable à la main : −1 000 le 01/01/2025, +1 100 le 01/01/2026 -> 10,0 %', () => {
  const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  assert.equal((r * 100).toFixed(4), '10.0000');
});

test('7d. XIRR multi-flux recoupé avec Excel (exemple de la documentation Microsoft de XIRR) : 37,34 %', () => {
  // Excel : =XIRR({-10000;2750;4250;3250;2750}; {01/01/2008;01/03/2008;30/10/2008;15/02/2009;01/04/2009}) = 0,373362535
  const r = xirr([
    { date: '2008-01-01', amount: -10000 }, { date: '2008-03-01', amount: 2750 }, { date: '2008-10-30', amount: 4250 },
    { date: '2009-02-15', amount: 3250 }, { date: '2009-04-01', amount: 2750 },
  ]);
  assert.equal(r.toFixed(6), '0.373363');
});

test('7e. XIRR : pas de solution sans flux sortant et entrant', () => {
  assert.equal(xirr([{ date: '2025-01-01', amount: -1000 }]), null);
  assert.equal(xirr([{ date: '2025-01-01', amount: 100 }, { date: '2026-01-01', amount: 100 }]), null);
});

test('7f. Export puis import JSON -> données strictement identiques', () => {
  const data = {
    prefs: { budget: 1200, day: 25, name: 'Zoé' },
    suivi: {
      startDate: '2026-10-01',
      products: [{ id: 'p1', name: 'SPYI', pct: 90 }, { id: 'p2', name: 'EIMI', pct: 10 }],
      investments: [
        { id: 'a1', date: '2026-10-26', fees: 4.95, note: 'ordre « au marché »', lines: [{ productId: 'p1', amount: 360 }, { productId: 'p2', amount: 40 }] },
        { id: 'a2', date: '2026-11-25', fees: 0, note: '', lines: [{ productId: 'p1', amount: 846 }, { productId: 'p2', amount: 94 }] },
      ],
      valuations: [{ id: 'v1', date: '2026-11-30', lines: [{ productId: 'p1', value: 1250.4 }, { productId: 'p2', value: 135 }] }],
    },
  };
  const back = importData(exportData(data));
  assert.deepEqual(back, data);
  assert.equal(exportData(back, new Date(0)), exportData(data, new Date(0)));
});

test('7f bis. Une sauvegarde de l\'ancien format (version 1) est convertie : montants au premier produit', () => {
  const v1 = JSON.stringify({ app: 'dca-optimise', version: 1, prefs: { budget: 1200, day: 25 }, suivi: {
    startDate: '2026-10-01', investments: [{ id: 'a1', date: '2026-10-26', amount: 400, fees: 5, note: '' }],
    valuations: [{ id: 'v1', date: '2026-10-31', value: 410 }] } });
  const { suivi } = importData(v1);
  assert.deepEqual(suivi.products, [{ id: 'p1', name: 'Mon ETF', pct: 100 }]);
  assert.deepEqual(suivi.investments[0].lines, [{ productId: 'p1', amount: 400 }]);
  assert.deepEqual(suivi.valuations[0].lines, [{ productId: 'p1', value: 410 }]);
});

test('7g. Import refusé si le fichier n\'est pas une sauvegarde valide', () => {
  assert.throws(() => importData('pas du json'), /JSON/);
  assert.throws(() => importData('{"app":"autre"}'), /sauvegarde/);
  assert.throws(() => importData(JSON.stringify({ app: 'dca-optimise', version: 1, suivi: { investments: [{ id: 'x', date: '2026-13-01', amount: 1 }] } })), /invalide/);
  assert.throws(() => importData(JSON.stringify({ app: 'dca-optimise', version: 1, suivi: { investments: [{ id: 'x', date: '2026-10-01', amount: -5 }] } })), /invalide/);
  // version 2 : produit inconnu, ou pourcentages qui ne font pas 100 %
  const v2 = suivi => JSON.stringify({ app: 'dca-optimise', version: 2, suivi });
  assert.throws(() => importData(v2({ products: [{ id: 'p1', name: 'A', pct: 100 }], investments: [{ id: 'x', date: '2026-10-01', fees: 0, lines: [{ productId: 'zz', amount: 5 }] }], valuations: [] })), /invalide/);
  assert.throws(() => importData(v2({ products: [{ id: 'p1', name: 'A', pct: 60 }], investments: [], valuations: [] })), /100/);
});

test('Mois suivis : départ, jour J passé ou non, mois en cours', () => {
  // départ le 01/10, J = 25, aujourd'hui le 18/10 : octobre pas encore dû
  assert.deepEqual(trackedMonths('2026-10-01', '2026-10-18', 25), []);
  // ... mais compté s'il a déjà une saisie
  assert.deepEqual(trackedMonths('2026-10-01', '2026-10-18', 25, [{ date: '2026-10-17', amount: 400 }]), ['2026-10']);
  // le 25 : octobre est dû
  assert.deepEqual(trackedMonths('2026-10-01', '2026-10-25', 25), ['2026-10']);
  // départ le 28/10 alors que J = 25 : premier mois = novembre
  assert.deepEqual(trackedMonths('2026-10-28', '2027-01-30', 25), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(trackedMonths(null, '2026-10-18', 25), []);
});

test('Frais : total, % investi, moyenne par investissement', () => {
  const f = feeStats([{ amount: 400, fees: 5 }, { amount: 1600, fees: 15 }]);
  assert.equal(f.total, 20);
  assert.equal(f.pct, 0.01);
  assert.equal(f.avg, 10);
});

test('Performance au dernier relevé (nette de frais), « peu significatif » sous un an', () => {
  const inv = [{ date: '2025-01-01', amount: 990, fees: 10 }, { date: '2026-06-01', amount: 500, fees: 0 }];
  const p = performance(inv, [{ date: '2026-01-01', value: 1100 }, { date: '2025-06-01', value: 1020 }]);
  assert.equal(p.date, '2026-01-01');          // dernier relevé
  assert.equal(p.invested, 990);               // l'investissement de juin 2026 est postérieur au relevé
  assert.equal(p.gain, 100);                   // 1 100 − 990 − 10
  assert.equal(p.simple, 0.1);
  assert.equal((p.xirr * 100).toFixed(4), '10.0000');
  assert.equal(p.shortHistory, false);
  assert.equal(performance(inv, [{ date: '2025-06-01', value: 1020 }]).shortHistory, true);
  assert.equal(performance(inv, []), null);
});

const SERIES = withPeaks([
  { date: '2026-01-23', close: 100 }, { date: '2026-01-26', close: 100 },
  { date: '2026-02-24', close: 80 }, { date: '2026-02-25', close: 80 },
  { date: '2026-03-24', close: 100 }, { date: '2026-03-25', close: 110 },
], null);

test('Simulation sur l\'indice : achat à la première clôture à partir de la date, valorisation à la dernière', () => {
  // 100 le 25/01 (dimanche) -> acheté le 26/01 à 100 ; 100 le 25/02 à 80 ; dernière clôture 110
  const s = simulateDca(SERIES, [{ date: '2026-01-25', amount: 100 }, { date: '2026-02-25', amount: 100 }]);
  assert.equal(s.invested, 200);
  assert.equal(s.value.toFixed(4), (100 / 100 * 110 + 100 / 80 * 110).toFixed(4)); // 247,50
  assert.equal(s.valueDate, '2026-03-25');
  assert.equal(simulateDca(SERIES, [{ date: '2026-04-25', amount: 100 }]).pending, 1);
});

test('Montant recommandé du mois et comparaison réel / optimisé / classique', () => {
  const ctx = { peaked: SERIES, tiers: TIERS, budget: 1200, day: 25 };
  const rec = ['2026-01', '2026-02', '2026-03'].map(m => recommendedFor(m, ctx));
  // 01 : clôture du 23/01 (DD 0) -> 400 ; 02 : 24/02 (−20 %) -> 2 800 ; 03 : 24/03 (0) -> 400
  assert.deepEqual(rec.map(r => [r.closeDate, r.amount]), [['2026-01-23', 400], ['2026-02-24', 2800], ['2026-03-24', 400]]);
  const c = compareDca({
    peaked: SERIES, months: ['2026-01', '2026-02', '2026-03'], recommended: rec, budget: 1200, day: 25,
    investments: [{ date: '2026-01-26', amount: 400 }, { date: '2026-02-25', amount: 2000 }],
  });
  assert.equal(c.classic.invested, 3600);
  assert.equal(c.optimized.invested, 3600);
  assert.equal(c.real.invested, 2400);
  assert.ok(c.optimized.value > c.classic.value); // plus investi dans le creux de février
});

test('Recommandé indisponible avant la date de validité du pic (historique incomplet)', () => {
  const ctx = { peaked: SERIES, tiers: TIERS, budget: 1200, day: 25, validFrom: '2026-03-01' };
  assert.equal(recommendedFor('2026-02', ctx), null);
  assert.equal(recommendedFor('2026-03', ctx).amount, 400);
  assert.equal(peakValidFrom([{ date: '2023-10-16', close: 100 }, { date: '2024-09-24', close: 122 }], [{ month: '2021-12', close: 110 }]), '2024-09-24');
});
