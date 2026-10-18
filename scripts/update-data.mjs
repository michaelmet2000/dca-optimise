#!/usr/bin/env node
// Mise à jour des données : complète l'historique JOURNALIER de l'indice actif et écrit data/state.json.
//
// Usage :  node scripts/update-data.mjs            (lancé par la GitHub Action, du lundi au samedi)
//          node scripts/update-data.mjs --offline  (historique + CSV manuel seulement)
//
// Sources pour les jours manquants :
//   1. Fichier manuel  data/manual/<indice>.xlsx (export msci.com, Price) ou .csv  (plan B, prioritaire)
//   2. Yahoo Finance (ticker de config.json) : 5 derniers jours seulement
// Les jours déjà présents dans data/history/ ne sont jamais réécrits : ce sont les clôtures de référence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPeaks, tierIndex, isWeekend, dailyFreshness, peakCoveredByHistory } from '../lib/model.js';
import { parseDailyCsv, parseClosesCsv, toHistoryCsv } from '../lib/parse.js';
import { fetchYahooRecentCloses } from './sources.mjs';
import { parseMsciXlsx } from './xlsx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => path.join(ROOT, p);
const OFFLINE = process.argv.includes('--offline');
const MAX_DAILY_MOVE = 0.15;     // variation d'un jour à l'autre au-delà de laquelle une valeur est jugée suspecte
const MAX_OVERLAP_GAP = 0.005;   // écart toléré entre la source et l'historique sur les jours communs (0,5 %)
const MAX_HOLE_DAYS = 7;         // trou toléré entre deux clôtures (week-end + jours fériés)

const config = JSON.parse(fs.readFileSync(rel('config.json'), 'utf8'));
const indexId = config.activeIndex;
const idx = config.indices[indexId];
if (!idx) throw new Error(`Indice actif « ${indexId} » absent de config.json`);

// Seuls les jours TERMINÉS sont acceptés : date strictement avant aujourd'hui (UTC), hors week-end.
// Cela écarte le point « en direct » que Yahoo ajoute pour la séance en cours ou le week-end.
const todayUtc = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log('[update]', ...a);
const errors = [];

// ---------- 1. Historique ----------
if (!fs.existsSync(rel(idx.historyFile))) {
  console.error(`[update] ERREUR : ${idx.historyFile} introuvable. Créer l'historique depuis l'export msci.com (README, section 1).`);
  process.exit(1);
}
const history = parseDailyCsv(fs.readFileSync(rel(idx.historyFile), 'utf8'));
const lastKnown = history.at(-1).date;
log(`historique : ${history.length} jours, ${history[0].date} -> ${lastKnown}`);

// ---------- 2. Sources ----------
let manual = [];
for (const f of idx.manualFiles ?? []) {
  if (!fs.existsSync(rel(f))) continue;
  try {
    const pts = f.endsWith('.xlsx') ? parseMsciXlsx(fs.readFileSync(rel(f)), { expectLevel: idx.level, expectCurrency: idx.currency }).points
      : parseDailyCsv(fs.readFileSync(rel(f), 'utf8'));
    manual = manual.concat(pts);
    log(`fichier manuel : ${pts.length} jours (${f})`);
  } catch (e) {
    errors.push(`fichier manuel ${f} ignoré : ${e.message}`);
  }
}

let online = [], source = null;
if (!OFFLINE) {
  try {
    online = await fetchYahooRecentCloses(idx.yahooTicker);
    source = `Yahoo Finance (${idx.yahooTicker})`;
    log(`Yahoo : ${online.length} jours, dernier = ${online.at(-1)?.date}`);
    // Contrôle de cohérence sur les jours déjà connus : protège contre un mauvais ticker ou une série corrompue.
    const known = new Map(history.map(p => [p.date, p.close]));
    for (const p of online) {
      const k = known.get(p.date);
      if (k != null && Math.abs(p.close / k - 1) > MAX_OVERLAP_GAP) {
        throw new Error(`incohérence le ${p.date} : ${p.close} contre ${k} dans l'historique`);
      }
    }
  } catch (e) {
    errors.push(`Yahoo : ${e.message}`);
    log(`échec Yahoo : ${e.message}`);
    online = [];
  }
}

// ---------- 3. Ajout des nouveaux jours ----------
const candidates = new Map();
for (const p of online) candidates.set(p.date, { ...p, src: source });
for (const p of manual) candidates.set(p.date, { ...p, src: 'fichier manuel' }); // le manuel est prioritaire
const fresh = [...candidates.values()]
  .filter(p => p.date > lastKnown && p.date < todayUtc && !isWeekend(p.date))
  .sort((a, b) => a.date.localeCompare(b.date));

const added = [];
for (const p of fresh) {
  const prev = history.at(-1);
  const holeDays = (Date.parse(p.date) - Date.parse(prev.date)) / 86400000;
  if (holeDays > MAX_HOLE_DAYS) {
    errors.push(`trou de ${holeDays} jours entre ${prev.date} et ${p.date} : ajout arrêté, déposer un export msci.com (plan B)`);
    break;
  }
  if (Math.abs(p.close / prev.close - 1) > MAX_DAILY_MOVE) {
    errors.push(`clôture du ${p.date} suspecte (${p.close} contre ${prev.close} la veille) : refusée, vérifier puis déposer un export msci.com`);
    break;
  }
  history.push({ date: p.date, close: p.close });
  added.push(p);
}
if (added.length) log(`jours ajoutés : ${added.length} (${added[0].date} -> ${added.at(-1).date})`);

// ---------- 4. État publié ----------
// Garde-fou : si l'historique journalier commence tard, aucun mois antérieur ne doit approcher son plus haut.
if (idx.monthlyReference && fs.existsSync(rel(idx.monthlyReference)) && !idx.priorPeak) {
  const chk = peakCoveredByHistory(history, parseClosesCsv(fs.readFileSync(rel(idx.monthlyReference), 'utf8')));
  if (!chk.ok) {
    const msg = `historique trop court : la clôture de ${chk.monthBefore} (${chk.maxBefore}) approche le plus haut de l'historique ; importer les années antérieures`;
    fs.writeFileSync(rel('data/state.json'), JSON.stringify({ maintenance: `Données incomplètes (${msg}). Aucun montant n'est affiché.` }) + '\n');
    console.error(`[update] ÉCHEC : ${msg}`);
    process.exit(1);
  }
}
const peaked = withPeaks(history, idx.priorPeak);
const last = peaked.at(-1);
const ti = tierIndex(last.dd, idx.tiers);
const status = dailyFreshness(last.date, todayUtc);

const state = {
  index: { id: indexId, name: idx.name, level: idx.level, currency: idx.currency, msciCode: idx.msciCode, ticker: idx.yahooTicker },
  // Dernière clôture connue et DD à cette date (référence générale ; le montant de chacun dépend de son jour J)
  lastDate: last.date,
  lastClose: last.close,
  ath: last.peak,                    // plus haute clôture journalière jusqu'à lastDate (pic injecté inclus)
  athDate: last.peakDate,
  dd: last.dd,
  tier: ti,
  tiers: idx.tiers,
  nominalBudget: config.nominalBudget,
  roundTo: config.roundTo,
  defaultInvestDay: config.defaultInvestDay,
  capacity: config.capacity,
  priorPeak: idx.priorPeak,          // pic antérieur au début de la série
  // Série journalière complète : le navigateur calcule le montant de chacun selon son jour d'investissement.
  series: history.map(p => [p.date, p.close]),
  update: {
    lastAttemptAt: new Date().toISOString(),
    status,                          // ok | late
    source: added.length ? [...new Set(added.map(p => p.src))].join(' + ') : (source ?? 'historique du repo'),
    sourceNote: `Historique : export msci.com depuis le ${history[0].date} ; jours suivants : Yahoo Finance ou export msci.com déposé à la main.`,
    errors,
  },
};
fs.writeFileSync(rel(idx.historyFile), toHistoryCsv(history));
fs.writeFileSync(rel('data/state.json'), JSON.stringify(state) + '\n');
log(`état : clôture ${last.date} = ${last.close}, pic ${last.peakDate} = ${last.peak}, DD = ${(last.dd * 100).toFixed(3)} %, palier ${ti + 1} (${idx.tiers[ti].amount} CHF de base)`);

if (status === 'late') {
  console.error(`[update] ÉCHEC : dernière clôture au ${last.date}, données en retard. ${errors.join(' | ')}`);
  process.exit(1); // workflow rouge (e-mail de GitHub) ; la page affiche « mise à jour en retard »
}
if (errors.length) console.warn('[update] avertissements :', errors.join(' | '));
