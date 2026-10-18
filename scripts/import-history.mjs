#!/usr/bin/env node
// Crée (ou complète) l'historique de référence de l'indice actif à partir des exports journaliers de msci.com
// (.xlsx, niveau Price, USD) ou de CSV date,close. msci.com limite l'export journalier à 3 ans : on peut
// donc donner plusieurs fichiers (ou un dossier), qui sont fusionnés et contrôlés.
//
// Usage : node scripts/import-history.mjs <fichier ou dossier> [autres…] [--force]
//   - sans --force : refuse d'écraser un historique existant… sauf pour le compléter (jours ajoutés,
//     jamais modifiés) ;
//   - avec --force : remplace l'historique.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDailyCsv, toHistoryCsv } from '../lib/parse.js';
import { isWeekend } from '../lib/model.js';
import { parseMsciXlsx } from './xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const FORCE = process.argv.includes('--force');
if (!args.length) { console.error('Usage : node scripts/import-history.mjs <export.xlsx | dossier | fichier.csv> […] [--force]'); process.exit(1); }

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const idx = config.indices[config.activeIndex];
const out = path.join(ROOT, idx.historyFile);
const MAX_HOLE_DAYS = 7;          // trou toléré entre deux clôtures (week-end + fériés)
const MAX_OVERLAP_GAP = 1e-6;     // deux fichiers qui se recouvrent doivent donner la même clôture

// Liste des fichiers (un dossier = tous ses .xlsx et .csv)
const files = args.flatMap(a => {
  const p = path.resolve(a);
  return fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter(f => /\.(xlsx|csv)$/i.test(f)).map(f => path.join(p, f))
    : [p];
});

const merged = new Map();
for (const f of files) {
  let points;
  if (f.toLowerCase().endsWith('.xlsx')) {
    const x = parseMsciXlsx(fs.readFileSync(f), { expectLevel: idx.level, expectCurrency: idx.currency });
    if (idx.name && !x.indexName.toLowerCase().includes(idx.name.toLowerCase())) {
      console.error(`${path.basename(f)} : indice « ${x.indexName} », attendu « ${idx.name} »`); process.exit(1);
    }
    points = x.points;
  } else {
    points = parseDailyCsv(fs.readFileSync(f, 'utf8'));
  }
  // Un export mensuel n'a qu'une valeur par mois : refusé (l'application a besoin de chaque jour).
  const months = new Set(points.map(p => p.date.slice(0, 7))).size;
  if (points.length > 3 && points.length < months * 10) {
    console.error(`${path.basename(f)} : ${points.length} valeurs pour ${months} mois, ce n'est pas un export journalier (Daily)`); process.exit(1);
  }
  for (const p of points) {
    const prev = merged.get(p.date);
    if (prev && Math.abs(prev.close / p.close - 1) > MAX_OVERLAP_GAP) {
      console.error(`Contradiction le ${p.date} : ${prev.close} contre ${p.close} (${path.basename(f)})`); process.exit(1);
    }
    merged.set(p.date, p);
  }
  console.log(`${path.basename(f)} : ${points.length} jours (${points[0].date} -> ${points.at(-1).date})`);
}

// Historique existant : on le complète sans jamais modifier un jour déjà présent.
if (fs.existsSync(out) && !FORCE) {
  for (const p of parseDailyCsv(fs.readFileSync(out, 'utf8'))) {
    const n = merged.get(p.date);
    if (n && Math.abs(n.close / p.close - 1) > 0.005) {
      console.error(`Le ${p.date}, l'historique vaut ${p.close} et le fichier ${n.close} : vérifier, ou relancer avec --force`); process.exit(1);
    }
    merged.set(p.date, p);
  }
}

// Les clôtures officielles sont calculées du lundi au vendredi : une date de week-end n'en est pas une.
const all = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
const weekend = all.filter(p => isWeekend(p.date));
if (weekend.length > all.length / 10) { console.error('Trop de dates de week-end : format de date mal reconnu ?'); process.exit(1); }
if (weekend.length) console.log(`${weekend.length} lignes de week-end écartées`);
const points = all.filter(p => !isWeekend(p.date));

// Contrôle de continuité : un trou signale une tranche manquante.
const holes = [];
for (let i = 1; i < points.length; i++) {
  const gap = (Date.parse(points[i].date) - Date.parse(points[i - 1].date)) / 86400000;
  if (gap > MAX_HOLE_DAYS) holes.push(`${points[i - 1].date} -> ${points[i].date} (${gap} jours)`);
}
if (holes.length) { console.error(`Trous dans l'historique (tranche manquante ?) :\n  ${holes.join('\n  ')}`); process.exit(1); }

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toHistoryCsv(points));
console.log(`${points.length} jours écrits dans ${idx.historyFile} (${points[0].date} -> ${points.at(-1).date})`);
