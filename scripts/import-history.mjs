#!/usr/bin/env node
// Crée l'historique de référence de l'indice actif à partir d'un CSV (export investing.com tel quel accepté).
// Usage : node scripts/import-history.mjs data/historique/MSCI_World_Historical_Data.csv [--force]
// Sans --force, refuse d'écraser un historique existant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDailyCsv, toHistoryCsv } from '../lib/parse.js';
import { isWeekend } from '../lib/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [csvPath] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!csvPath) { console.error('Usage : node scripts/import-history.mjs <fichier.csv> [--force]'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const idx = config.indices[config.activeIndex];
const out = path.join(ROOT, idx.historyFile);
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error(`${idx.historyFile} existe déjà. Ajouter --force pour l'écraser.`); process.exit(1);
}
const all = parseDailyCsv(fs.readFileSync(path.resolve(csvPath), 'utf8'));
// investing.com ajoute parfois des lignes datées du dimanche (cotations du matin en Asie) : ce ne sont pas des
// clôtures officielles MSCI (calculées du lundi au vendredi). Elles sont écartées.
const weekend = all.filter(p => isWeekend(p.date));
if (weekend.length > all.length / 10) { console.error('Trop de dates de week-end : format de date mal reconnu ?'); process.exit(1); }
if (weekend.length) console.log(`${weekend.length} lignes de week-end écartées (${weekend.map(p => p.date).join(', ')})`);
const points = all.filter(p => !isWeekend(p.date));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toHistoryCsv(points));
console.log(`${points.length} jours écrits dans ${idx.historyFile} (${points[0].date} -> ${points.at(-1).date})`);
