#!/usr/bin/env node
// Crée l'historique de référence de l'indice actif à partir de l'export journalier de msci.com (.xlsx,
// niveau Price, USD) ou d'un CSV date,close.
// Usage : node scripts/import-history.mjs "chemin/vers/export.xlsx" [--force]
// Sans --force, refuse d'écraser un historique existant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDailyCsv, toHistoryCsv } from '../lib/parse.js';
import { isWeekend } from '../lib/model.js';
import { parseMsciXlsx } from './xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [srcPath] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!srcPath) { console.error('Usage : node scripts/import-history.mjs <export.xlsx | fichier.csv> [--force]'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const idx = config.indices[config.activeIndex];
const out = path.join(ROOT, idx.historyFile);
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error(`${idx.historyFile} existe déjà. Ajouter --force pour l'écraser.`); process.exit(1);
}

let all;
if (srcPath.toLowerCase().endsWith('.xlsx')) {
  const x = parseMsciXlsx(fs.readFileSync(path.resolve(srcPath)), { expectLevel: idx.level, expectCurrency: idx.currency });
  console.log(`Export msci.com : « ${x.indexName} », niveau ${x.level}, ${x.currency}`);
  all = x.points;
} else {
  all = parseDailyCsv(fs.readFileSync(path.resolve(srcPath), 'utf8'));
}
// Les clôtures officielles sont calculées du lundi au vendredi : une date de week-end n'en est pas une.
const weekend = all.filter(p => isWeekend(p.date));
if (weekend.length > all.length / 10) { console.error('Trop de dates de week-end : format de date mal reconnu ?'); process.exit(1); }
if (weekend.length) console.log(`${weekend.length} lignes de week-end écartées (${weekend.map(p => p.date).join(', ')})`);
const points = all.filter(p => !isWeekend(p.date));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toHistoryCsv(points));
console.log(`${points.length} jours écrits dans ${idx.historyFile} (${points[0].date} -> ${points.at(-1).date})`);
