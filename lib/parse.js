// Lecture des fichiers CSV de clôtures. Formats acceptés :
//  - export investing.com français : "Date","Dernier",...  dates jj/mm/aaaa, nombres "1.234,56"
//  - export investing.com anglais  : "Date","Price",...    dates mm/dd/yyyy, nombres "1,234.56"
//  - format simple du repo         : date,close            dates aaaa-mm-jj, nombres 1234.56

import { lastWeekdayOfMonth, monthOf } from './model.js';

/**
 * Nombre au format français/suisse ou anglais -> Number.
 * `decimal` = séparateur décimal du fichier ("," pour investing.com en français, "." sinon).
 *   parseNumber("7.651,54", ",") -> 7651.54     parseNumber("1'500,5", ",") -> 1500.5
 *   parseNumber("1,234.56", ".") -> 1234.56     parseNumber("−4,5 %", ",") -> -4.5
 * Sans `decimal` : si les deux séparateurs sont présents, le dernier est la décimale ;
 * s'il n'y en a qu'un, il est décimal sauf s'il est répété ou suivi d'exactement 3 chiffres.
 * Renvoie NaN si le texte n'est pas un nombre.
 */
export function parseNumber(s, decimal) {
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/[\s  '’%]/g, '').replace(/^[−–]/, '-');
  if (!decimal) {
    const hasDot = t.includes('.'), hasComma = t.includes(',');
    if (hasDot && hasComma) decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    else {
      const sep = hasDot ? '.' : hasComma ? ',' : null;
      const repeated = sep && t.split(sep).length > 2;
      const threeAfter = sep && /^\d{3}$/.test(t.split(sep).pop());
      decimal = sep && !repeated && !threeAfter ? sep : (sep === '.' ? ',' : '.');
    }
  }
  const thousands = decimal === ',' ? '.' : ',';
  t = t.split(thousands).join('').replace(decimal, '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/** Découpe une ligne CSV (séparateur "," ou ";", champs éventuellement entre guillemets). */
export function splitCsvLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

/** Date texte -> "AAAA-MM-JJ". `dayFirst` : jj/mm/aaaa (français) sinon mm/dd/yyyy (anglais). */
export function parseDate(s, dayFirst = true) {
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  // mois seul ("2026-09" ou "09/2026") -> 1er du mois (traité ensuite comme fichier mensuel)
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  if ((m = s.match(/^(\d{1,2})[./](\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!m) throw new Error(`Date illisible : « ${s} »`);
  const [a, b, y] = [m[1], m[2], m[3]];
  const [d, mo] = dayFirst ? [a, b] : [b, a];
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) throw new Error(`Date invalide : « ${s} »`);
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * CSV de clôtures -> points [{date, close}] triés par date, sans doublon.
 * Seules les colonnes Date et Dernier/Price/Close sont lues.
 */
export function parseDailyCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV vide');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = splitCsvLine(lines[0], sep).map(h => h.toLowerCase().trim());
  const iDate = header.findIndex(h => h === 'date' || h === 'mois');
  let iClose = header.findIndex(h => ['dernier', 'clôture', 'cloture', 'close', 'price', 'prix'].includes(h));
  if (iClose < 0) iClose = header.findIndex(h => /^(cl[oô]ture|close)/.test(h)); // ex. "cloture_price_usd"
  if (iDate < 0 || iClose < 0) throw new Error(`Colonnes "Date" et "Dernier"/"Price"/"Close" introuvables (en-tête : ${lines[0]})`);
  // investing.com anglais ("Price") : dates mm/dd/yyyy, milliers ","; français ("Dernier") : jj/mm/aaaa, milliers "."
  // Autres en-têtes : séparateur décimal détecté valeur par valeur.
  const english = header[iClose] === 'price';
  const decimal = english || header[iClose] === 'close' ? '.' : header[iClose] === 'dernier' ? ',' : undefined;
  const byDate = new Map();
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line, sep);
    const rawDate = f[iDate];
    const date = parseDate(rawDate, !english);
    const close = parseNumber(f[iClose], decimal);
    if (!(close > 0)) throw new Error(`Clôture invalide pour ${rawDate} : « ${f[iClose]} »`);
    byDate.set(date, { date, close });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * CSV de clôtures -> série MENSUELLE triée [{month, date, close}] (dernière clôture de chaque mois).
 * Fichier mensuel investing.com : chaque ligne porte le 1er du mois ; la date de clôture réelle est
 * inconnue, on met le dernier jour ouvré du mois.
 */
export function parseClosesCsv(text) {
  const byMonth = new Map();
  for (const p of parseDailyCsv(text)) byMonth.set(monthOf(p.date), { month: monthOf(p.date), date: p.date, close: p.close });
  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  // Fichier mensuel : toutes les dates au 1er du mois -> on remplace par le dernier jour ouvré.
  // (Le 1er n'est jamais le dernier jour de bourse d'un mois : aucune confusion possible avec un fichier journalier.)
  if (rows.every(r => r.date.endsWith('-01'))) {
    for (const r of rows) { r.date = lastWeekdayOfMonth(r.month); r.dateEstimated = true; }
  }
  return rows;
}

/** Points -> CSV simple du repo (date,close). */
export function toHistoryCsv(rows) {
  return 'date,close\n' + rows.map(r => `${r.date},${r.close}`).join('\n') + '\n';
}
