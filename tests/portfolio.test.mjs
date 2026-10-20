// Portefeuille par produit : répartition du montant, lien, conversion de l'ancien format, performance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAmount, parsePortfolioParam, portfolioParam, validateProducts, migrateSuivi, productPerformance, flatInvestments, flatValuations } from '../lib/portfolio.js';
import { scaledAmount } from '../lib/model.js';

const P = [{ id: 'p1', name: 'SPYI', pct: 90 }, { id: 'p2', name: 'EIMI', pct: 10 }];

test('Répartition du montant du mois selon les pourcentages (somme toujours exacte)', () => {
  assert.deepEqual(splitAmount(400, P), [{ productId: 'p1', amount: 360 }, { productId: 'p2', amount: 40 }]);
  assert.deepEqual(splitAmount(170, P), [{ productId: 'p1', amount: 153 }, { productId: 'p2', amount: 17 }]);
  const three = [{ id: 'a', pct: 33.4 }, { id: 'b', pct: 33.3 }, { id: 'c', pct: 33.3 }];
  const parts = splitAmount(940, three);                                   // 313,96 ; 313,02 ; 313,02
  assert.deepEqual(parts.map(p => p.amount), [314, 313, 313]);
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), 940);
  assert.deepEqual(splitAmount(100.5, P).map(p => p.amount), [90.45, 10.05]); // montant non entier : au centime
});

test('Budget de 500 CHF : paliers ajustés proportionnellement au budget de référence (1 200)', () => {
  // 166,67 ; 391,67 ; 833,33 ; 1 166,67 ; 1 458,33 arrondis aux 10 CHF
  assert.deepEqual([400, 940, 2000, 2800, 3500].map(t => scaledAmount(t, 500)), [170, 390, 830, 1170, 1460]);
  assert.deepEqual(splitAmount(scaledAmount(400, 500), P).map(p => p.amount), [153, 17]);
});

test('Portefeuille dans le lien : ?p=SPYI:90,EIMI:10', () => {
  assert.equal(portfolioParam(P), 'SPYI:90,EIMI:10');
  assert.deepEqual(parsePortfolioParam('SPYI:90,EIMI:10'), [{ name: 'SPYI', pct: 90 }, { name: 'EIMI', pct: 10 }]);
  assert.deepEqual(parsePortfolioParam('VWRL:100'), [{ name: 'VWRL', pct: 100 }]);
  assert.deepEqual(parsePortfolioParam('A:33.4,B:33.3,C:33.3').map(p => p.pct), [33.4, 33.3, 33.3]);
  assert.equal(parsePortfolioParam('SPYI:90,EIMI:5'), null);   // total 95 %
  assert.equal(parsePortfolioParam('SPYI:90,spyi:10'), null);  // doublon
  assert.equal(parsePortfolioParam(''), null);
});

test('Validation du portefeuille', () => {
  assert.equal(validateProducts(P), null);
  assert.match(validateProducts([]), /au moins/);
  assert.match(validateProducts([{ name: 'A', pct: 50 }]), /100/);
  assert.match(validateProducts([{ name: '', pct: 100 }]), /nom/);
});

test('Conversion de l\'ancien format (un montant par saisie) vers le format par produit', () => {
  const s = migrateSuivi({ startDate: '2026-10-01', investments: [{ id: 'a', date: '2026-10-26', amount: 400, fees: 5 }], valuations: [{ id: 'v', date: '2026-10-31', value: 410 }] });
  assert.equal(s.products.length, 1);
  assert.deepEqual(flatInvestments(s), [{ id: 'a', date: '2026-10-26', amount: 400, fees: 5, note: '' }]);
  assert.deepEqual(flatValuations(s), [{ id: 'v', date: '2026-10-31', value: 410 }]);
  assert.deepEqual(migrateSuivi(s), s); // déjà converti : inchangé
});

test('Performance par produit : frais répartis au prorata, TRI, poids réel vs cible', () => {
  const suivi = {
    products: P,
    investments: [{ id: 'a', date: '2025-01-01', fees: 10, lines: [{ productId: 'p1', amount: 900 }, { productId: 'p2', amount: 100 }] }],
    valuations: [{ id: 'v', date: '2026-01-01', lines: [{ productId: 'p1', value: 999 }, { productId: 'p2', value: 101 }] }],
  };
  const [spyi, eimi] = productPerformance(suivi);
  assert.equal(spyi.invested, 900);
  assert.equal(spyi.fees, 9);                            // 10 × 900 / 1 000
  assert.equal(spyi.gain, 90);                           // 999 − 900 − 9
  assert.equal((spyi.xirr * 100).toFixed(4), '9.9010');  // 999 / 909 − 1, sur 365 jours
  assert.equal(eimi.gain, 0);                            // 101 − 100 − 1
  assert.equal(spyi.weight.toFixed(4), (999 / 1100).toFixed(4));
  assert.equal(spyi.targetPct, 90);
});
