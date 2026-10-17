// Test 4 : parsing des formats numériques français/suisses, et affichage au format suisse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDate, parseClosesCsv, parseDailyCsv } from '../lib/parse.js';
import { fmtCHF, fmtDD, fmtNum, fmtDate, fmtPct } from '../lib/format.js';

test('4. Nombres au format français (investing.com) : milliers « . », décimale « , »', () => {
  assert.equal(parseNumber('7.651,54', ','), 7651.54);
  assert.equal(parseNumber('89,50', ','), 89.5);
  assert.equal(parseNumber('1.234.567,8', ','), 1234567.8);
  assert.equal(parseNumber('996', ','), 996);
  assert.equal(parseNumber('-0,45%', ','), -0.45);
  assert.equal(parseNumber('−4,5 %', ','), -4.5);
});

test('4b. Nombres au format suisse et anglais', () => {
  assert.equal(parseNumber("1'500", ','), 1500);
  assert.equal(parseNumber("1’500,25", ','), 1500.25);
  assert.equal(parseNumber('1,234.56', '.'), 1234.56);
  assert.equal(parseNumber('7651.54', '.'), 7651.54);
});

test('4c. Nombres sans indication de format (détection)', () => {
  assert.equal(parseNumber('7.651,54'), 7651.54);
  assert.equal(parseNumber('7,651.54'), 7651.54);
  assert.equal(parseNumber('89,50'), 89.5);
  assert.equal(parseNumber('1.234'), 1234);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('')));
});

test('4d. Dates jj/mm/aaaa', () => {
  assert.equal(parseDate('01/02/1970'), '1970-02-01');
  assert.equal(parseDate('31.08.2026'), '2026-08-31');
  assert.equal(parseDate('2026-08-31'), '2026-08-31');
  assert.equal(parseDate('02/01/1970', false), '1970-02-01'); // format anglais mm/dd/yyyy
  assert.throws(() => parseDate('31/13/2026'));
});

test('4e. CSV investing.com français complet (guillemets, plus récent en haut)', () => {
  const csv = '﻿"Date","Dernier","Ouv."," Plus Haut","Plus Bas","Vol.","Variation %"\n' +
    '"01/09/2026","7.651,54","7.635,47","7.782,19","7.507,77","","-0,45%"\n' +
    '"01/08/2026","7.686,14","7.504,78","7.816,70","7.504,78","","2,62%"\n' +
    '"01/07/2026","7.489,72","7.478,84","7.581,50","7.313,92","","-0,13%"\n';
  const rows = parseClosesCsv(csv);
  assert.deepEqual(rows.map(r => [r.month, r.close]), [['2026-07', 7489.72], ['2026-08', 7686.14], ['2026-09', 7651.54]]);
  assert.equal(rows[2].date, '2026-09-30'); // fichier mensuel : dernier jour ouvré
});

test('4e bis. CSV manuel investing.com d\'une seule ligne (plan B)', () => {
  const rows = parseClosesCsv('"Date","Dernier"\n"01/09/2026","7.651,54"\n');
  assert.deepEqual(rows, [{ month: '2026-09', date: '2026-09-30', close: 7651.54, dateEstimated: true }]);
});

test('4g. CSV investing.com anglais (MSCI World) : Date MM/JJ/AAAA, milliers ","', () => {
  const csv = '﻿"Date","Price","Open","High","Low","Vol.","Change %"\n' +
    '"10/16/2026","4,907.78","4,934.63","4,952.60","4,892.66","","-0.51%"\n' +
    '"10/15/2026","4,932.95","4,921.46","4,937.62","4,890.27","","0.34%"\n' +
    '"07/09/2012","1,224.14","1,227.36","1,227.84","1,220.57","","-0.43%"\n';
  assert.deepEqual(parseDailyCsv(csv), [
    { date: '2012-07-09', close: 1224.14 }, { date: '2026-10-15', close: 4932.95 }, { date: '2026-10-16', close: 4907.78 },
  ]);
});

test('4h. CSV mensuel avec colonne « mois » (export msci.com retravaillé)', () => {
  const rows = parseClosesCsv('mois,cloture_price_usd,drawdown_pct\n1997-01,820.36,0\n1997-02,825.10,0\n09/2026,4957.10,-1.5\n');
  assert.deepEqual(rows.map(r => [r.month, r.close]), [['1997-01', 820.36], ['1997-02', 825.1], ['2026-09', 4957.1]]);
  assert.equal(rows[2].date, '2026-09-30');
});

test('4f. CSV avec point-virgule et CSV simple du repo', () => {
  assert.equal(parseClosesCsv('Date;Dernier\n30/09/2026;7.651,54\n31/08/2026;7.686,14\n')[1].close, 7651.54);
  const rows = parseClosesCsv('date,close\n2026-08-31,7686.14\n2026-09-30,7651.54\n');
  assert.deepEqual(rows.at(-1), { month: '2026-09', date: '2026-09-30', close: 7651.54 });
});

test('Affichage suisse', () => {
  assert.equal(fmtCHF(1500), '1\'500 CHF');
  assert.equal(fmtCHF(660), '660 CHF');
  assert.equal(fmtCHF(12345), '12\'345 CHF');
  assert.equal(fmtNum(7651.54), '7\'651,54');
  assert.equal(fmtDate('2026-08-31'), '31/08/2026');
  assert.equal(fmtPct(0.1), '10,0 %');
});

test('Affichage du DD tronqué : jamais en contradiction avec le palier', () => {
  assert.equal(fmtDD(-0.05), '−5,00 %');
  assert.equal(fmtDD(-0.04999), '−4,99 %');   // palier 660 : on n'affiche pas « −5,00 % »
  assert.equal(fmtDD(-0.120049), '−12,00 %');
  assert.equal(fmtDD(-0.0045016), '−0,45 %');
  assert.equal(fmtDD(0), '0,00 %');
});
