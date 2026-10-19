// Écran principal : montant du mois selon le budget et le jour d'investissement de la personne.
import { scaledAmount, tierIndex, tierLabels, withPeaks, monthSituation, monthEndDrawdowns, dailyFreshness, isWeekend, investDateOf, addMonths, monthOf } from './lib/model.js';
import { fmtCHF, fmtDD, fmtNum, fmtDate } from './lib/format.js';
import { loadPrefs, savePrefs, parseBudget, parseDay } from './lib/prefs.js';
import { initSuivi, render as renderSuivi } from './suivi.js';

const $ = id => document.getElementById(id);
const TIER_COLORS = ['var(--t0)', 'var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

let state = null, peaked = null;
let prefs = loadPrefs();

/** Date du jour sur l'appareil, AAAA-MM-JJ (heure locale, pas UTC). */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const shortDate = iso => fmtDate(iso).slice(0, 5); // "16/10"
const weekdayOf = iso => WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
/** "le 25/10/2026", avec la mention « prochain jour ouvrable » si c'est un week-end. */
const investLabel = iso => `le ${fmtDate(iso)}` + (isWeekend(iso) ? ` (${weekdayOf(iso)} : prochain jour ouvrable)` : '');

async function loadState() {
  const r = await fetch('data/state.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const s = await r.json();
  // État « maintenance » (ex. changement d'indice) : aucun montant n'est affiché
  if (s.maintenance) throw Object.assign(new Error(s.maintenance), { maintenance: true });
  // contrôle minimal : on ne montre jamais un chiffre issu d'un fichier incomplet
  for (const k of ['lastDate', 'series', 'tiers', 'nominalBudget', 'roundTo']) {
    if (s[k] == null) throw new Error(`champ « ${k} » manquant`);
  }
  if (!s.series.length) throw new Error('série vide');
  return s;
}

function showBanner(kind, text) {
  $('banner').className = `banner ${kind}`;
  $('banner').textContent = text;
}

function render() {
  const { budget, name, day } = prefs;
  $('hello').textContent = name ? `DCA optimisé · ${name}` : 'DCA optimisé';
  document.title = name ? `DCA optimisé · ${name}` : 'DCA optimisé';
  $('budgetInput').value = budget;
  $('dayInput').value = day;
  $('prefsSummary').textContent = `Budget ${fmtCHF(budget)} · le ${day} du mois · modifier`;
  if (prefs.isDefault) $('prefsDetails').open = true;
  if (!state) return;

  const s = state;
  const tiers = s.tiers;
  const today = todayIso();
  const sit = monthSituation(peaked, today, day);
  if (!sit.point) { showBanner('bad', 'Aucune clôture disponible pour ce calcul.'); $('amount').textContent = '—'; return; }
  const p = sit.point;
  const ti = tierIndex(p.dd, tiers);
  const amounts = tiers.map(t => scaledAmount(t.amount, budget, s.nominalBudget, s.roundTo));

  // --- avertissements : jamais de chiffre douteux sans le dire ---
  const late = dailyFreshness(s.lastDate, today) === 'late';
  const provisional = late || !sit.complete;
  if (late) {
    showBanner('bad', `Données au ${fmtDate(s.lastDate)} — mise à jour en retard. Le montant ci-dessous peut être faux.`);
  } else if (!sit.complete) {
    showBanner('warn', `Montant provisoire : la clôture de la veille de ton investissement (${investLabel(sit.investDate)}) n'est pas encore disponible. Calcul basé sur la clôture du ${fmtDate(p.date)}.`);
  } else {
    $('banner').className = 'banner hidden';
  }

  // --- 1. montant ---
  $('amount').textContent = fmtCHF(amounts[ti]);
  $('amount').classList.toggle('stale', provisional);
  const nextMonthDate = investDateOf(addMonths(monthOf(today), 1), day);
  if (sit.mode === 'estimate') {
    $('mode').textContent = `Estimation si tu investissais aujourd'hui (clôture du ${shortDate(p.date)})`;
    $('heroSub').textContent = `Ton investissement est prévu ${investLabel(sit.investDate)}. Le montant sera figé avec la dernière clôture avant cette date. Budget moyen ${fmtCHF(budget)}.`;
  } else {
    $('mode').textContent = `Montant de ton investissement du ${shortDate(sit.investDate)} (clôture du ${shortDate(p.date)})`;
    $('heroSub').textContent = `Prochain investissement : ${investLabel(nextMonthDate)}. Budget moyen ${fmtCHF(budget)}.`;
  }

  // --- 2. faits ---
  $('dd').textContent = fmtDD(p.dd);
  $('tier').textContent = `${ti + 1} / ${tiers.length}`;
  $('close').textContent = `${s.index.name} ${s.index.level} : ${fmtNum(p.close)} au ${fmtDate(p.date)}`;
  $('ath').textContent = `${fmtNum(p.peak)} au ${fmtDate(p.peakDate)}`;

  // --- 3. jauge ---
  renderGauge(p.dd, tiers, ti);

  // --- 4. paliers ---
  const labels = tierLabels(tiers);
  $('tiersTitle').textContent = `Paliers pour un budget de ${fmtCHF(budget)}`;
  $('tiers').innerHTML = '<tr><th>Drawdown</th><th class="num">Montant</th></tr>' + tiers.map((t, i) =>
    `<tr class="${i === ti ? 'active' : ''}"><td><span class="dot" style="background:${TIER_COLORS[i]}"></span>${labels[i]}</td><td class="num">${fmtCHF(amounts[i])}</td></tr>`
  ).join('');
  $('tiersNote').textContent = budget === s.nominalBudget
    ? `Montants du modèle de référence. Arrondis aux ${s.roundTo} CHF.`
    : `Montants du modèle de référence (budget ${fmtCHF(s.nominalBudget)}) × ${fmtNum(budget, 0)} / ${fmtNum(s.nominalBudget, 0)}, arrondis aux ${s.roundTo} CHF.`;

  // --- 6. capacité à prévoir ---
  const c = s.capacity;
  if (c) {
    const r = x => fmtCHF(Math.round(budget * x / s.roundTo) * s.roundTo);
    const mult = x => String(x).replace('.', ',');
    $('capacity').innerHTML = `Dans les pires périodes historiques du ${s.index.name}, le modèle a demandé ` +
      `<strong>${mult(c.peakMultiple)} × B par mois pendant ${c.peakDuration}</strong> (${c.peakPeriod}), soit ${r(c.peakMultiple)} par mois pour toi, ` +
      `et <strong>≈ ${mult(c.longMultipleMin)} à ${mult(c.longMultipleMax)} × B par mois en moyenne pendant ${c.longDuration}</strong> (${c.longPeriods}), ` +
      `soit ${r(c.longMultipleMin)} à ${r(c.longMultipleMax)} par mois. ` +
      `Assure-toi de pouvoir le financer sans toucher à ton épargne de sécurité.`;
  }

  // --- 5. graphique ---
  // Historique incomplet : avant `validFrom`, le pic (donc le DD) n'est pas sûr -> on ne l'affiche pas.
  const hist = monthEndDrawdowns(peaked, 121).filter(([m]) => !s.validFrom || m >= s.validFrom.slice(0, 7));
  $('chartTitle').textContent = hist.length >= 121 ? 'Drawdown fin de mois, 10 ans'
    : `Drawdown fin de mois depuis ${hist[0][0].slice(5, 7)}/${hist[0][0].slice(0, 4)}`;
  renderChart(hist, tiers);

  // --- 7. pied de page ---
  const upd = s.update || {};
  const when = upd.lastAttemptAt ? new Date(upd.lastAttemptAt).toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  $('source').textContent = `Indice : ${s.index.name} ${s.index.level} ${s.index.currency} (code MSCI ${s.index.msciCode}). ` +
    `Dernière clôture : ${fmtDate(s.lastDate)}. ${upd.sourceNote || ''} Dernière mise à jour : ${when}.`;
}

/** Barre à 5 segments de largeur égale ; le repère se place proportionnellement à l'intérieur du segment. */
function renderGauge(dd, tiers, ti) {
  const bounds = [0, ...tiers.slice(0, -1).map(t => t.above), Math.min(-0.5, tiers.at(-2).above - 0.2)];
  const segW = 100 / tiers.length;
  const hi = bounds[ti], lo = bounds[ti + 1];
  const within = Math.min(1, Math.max(0, (hi - dd) / (hi - lo)));
  const pos = Math.min(99, Math.max(1, (ti + within) * segW));
  const pct = b => b === 0 ? '0' : `−${Math.round(-b * 100)}`;
  $('gauge').innerHTML =
    `<div class="marker" style="left:clamp(0px, calc(${pos}% - 35px), calc(100% - 70px))">${fmtDD(dd)}</div>` +
    `<div class="bar">${tiers.map((_, i) => `<div class="seg" style="background:${TIER_COLORS[i]}"></div>`).join('')}</div>` +
    `<div class="needle" style="left:${pos}%"></div>` +
    `<div class="ticks">${bounds.slice(0, -1).map(b => `<span>${pct(b)}</span>`).join('')}<span>%</span></div>`;
}

/** Courbe du DD de fin de mois (SVG fait main, sans librairie). */
function renderChart(hist, tiers) {
  if (hist.length < 2) { $('chart').textContent = 'Pas assez de données.'; return; }
  const W = 340, H = 170, L = 30, R = 6, T = 8, B = 18;
  const minDD = Math.min(-0.3, ...hist.map(h => h[1])) - 0.02;
  const x = i => L + (i / (hist.length - 1)) * (W - L - R);
  const y = v => T + (v / minDD) * (H - T - B);
  const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h[1]).toFixed(1)}`);
  const thr = tiers.slice(0, -1).map(t => t.above).filter(v => v > minDD);
  const years = [];
  const everyYears = hist.length > 60 ? 2 : 1; // une année sur deux au-delà de 5 ans
  hist.forEach((h, i) => { if (h[0].endsWith('-01') && Number(h[0].slice(0, 4)) % everyYears === 0) years.push([i, h[0].slice(0, 4)]); });
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Drawdown de fin de mois des 10 dernières années">
    <line class="grid" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    ${thr.map(v => `<line class="thr" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`).join('')}
    <text class="axis" x="${L - 4}" y="${y(0) + 3}" text-anchor="end">0%</text>
    <polygon class="area" points="${x(0)},${y(0)} ${pts.join(' ')} ${x(hist.length - 1)},${y(0)}"/>
    <polyline class="line" points="${pts.join(' ')}"/>
    ${years.map(([i, yr]) => `<text class="axis" x="${x(i)}" y="${H - 4}" text-anchor="middle">${yr}</text>`).join('')}
  </svg>`;
}

$('prefsForm').addEventListener('submit', e => {
  e.preventDefault();
  const b = parseBudget($('budgetInput').value);
  const d = parseDay($('dayInput').value);
  if (!b) { $('budgetInput').setCustomValidity('Entre 50 et 100 000 CHF, nombre entier'); $('budgetInput').reportValidity(); return; }
  if (!d) { $('dayInput').setCustomValidity('Un jour entre 1 et 31'); $('dayInput').reportValidity(); return; }
  // Retire b et j de l'adresse pour qu'un rechargement ne réimpose pas les valeurs du lien.
  const q = new URLSearchParams(location.search); q.delete('b'); q.delete('j');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  setPrefs({ budget: b, day: d });
  $('prefsDetails').open = false;
});
for (const id of ['budgetInput', 'dayInput']) $(id).addEventListener('input', () => $(id).setCustomValidity(''));

/** Change le budget et le jour (formulaire ou import d'une sauvegarde) et rafraîchit les deux onglets. */
function setPrefs({ budget, day }) {
  savePrefs({ budget, day });
  prefs = { ...prefs, budget, day, isDefault: false };
  render();
  renderSuivi();
}

// ---------- Onglets « Ce mois-ci » / « Mon suivi » (adresse #suivi pour ouvrir directement le suivi) ----------
function showTab() {
  const suivi = location.hash === '#suivi';
  $('tabMois').classList.toggle('hidden', suivi);
  $('tabSuivi').classList.toggle('hidden', !suivi);
  $('tabBtnMois').setAttribute('aria-selected', String(!suivi));
  $('tabBtnSuivi').setAttribute('aria-selected', String(suivi));
}
window.addEventListener('hashchange', () => { showTab(); window.scrollTo(0, 0); });
showTab();

render();
loadState()
  .then(s => {
    state = s;
    peaked = withPeaks(s.series.map(([date, close]) => ({ date, close })), s.priorPeak);
    render();
    initSuivi({ state, peaked, getPrefs: () => prefs, setPrefs, today: todayIso });
  })
  .catch(err => {
    showBanner(err.maintenance ? 'warn' : 'bad', err.maintenance ? err.message
      : `Impossible de charger les données (${err.message}). Aucun montant n'est affiché pour éviter un chiffre faux. Réessaie plus tard.`);
    $('amount').textContent = '—';
  });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA facultative */ });
}
