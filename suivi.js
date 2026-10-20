// Onglet « Mon suivi » : portefeuille, saisies par produit, indicateurs, comparaison des DCA, graphiques, sauvegarde.
// Les calculs sont dans lib/tracking.js et lib/portfolio.js (testés) ; ce fichier ne fait que l'affichage et les saisies.
import { trackedMonths, recommendedFor, objectiveStats, feeStats, performance, compareDca, exportData, importData } from './lib/tracking.js';
import { splitAmount, investmentTotal, valuationTotal, flatInvestments, flatValuations, productPerformance, parsePortfolioParam } from './lib/portfolio.js';
import { investDateOf, monthOf, addMonths, isWeekend } from './lib/model.js';
import { fmtCHF, fmtNum, fmtPct, fmtDD, fmtDate, fmtMonth } from './lib/format.js';
import { loadSuivi, saveSuivi, storageAvailable, lastExportDate, markExported, newId } from './lib/store.js';
import { lineChart } from './lib/charts.js';
import { renderPfEditor, checkPfEditor } from './lib/pfeditor.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COLORS = { real: 'var(--accent)', target: 'var(--muted)', reco: 'var(--reco)', value: 'var(--good)' };

let ctx = null;            // { state, peaked, getPrefs, setPrefs, today, onProductsChange }
let suivi = loadSuivi();
let editing = null;        // id de la saisie en cours de modification
let linesTouched = false;  // l'utilisateur a modifié les montants pré-remplis

const fmtCHF2 = v => `${fmtNum(v, 2)} CHF`;
const signed = (v, f) => (v > 0 ? '+' : '') + f(v);
const money = v => Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
const pctLabel = v => `${fmtNum(v, Number.isInteger(v) ? 0 : 1)} %`;
const productName = id => suivi.products.find(p => p.id === id)?.name ?? '?';

/** Produits du portefeuille (pour la répartition affichée dans l'onglet « Ce mois-ci »). */
export const getProducts = () => suivi.products;

function persist() {
  if (!saveSuivi(suivi)) $('suiviStorageWarn').classList.remove('hidden');
  render();
  ctx?.onProductsChange?.();
}

/** Contexte de calcul du montant recommandé. */
function recoCtx() {
  const { state: s, peaked } = ctx, p = ctx.getPrefs();
  return { peaked, tiers: s.tiers, budget: p.budget, day: p.day, nominalBudget: s.nominalBudget, roundTo: s.roundTo, validFrom: s.validFrom };
}

/** Date proposée pour un nouvel investissement : jour J du mois (jour ouvré suivant si week-end), sans dépasser aujourd'hui. */
function defaultInvestDate() {
  const today = ctx.today();
  const dt = new Date(investDateOf(monthOf(today), ctx.getPrefs().day) + 'T00:00:00Z');
  while (isWeekend(dt.toISOString().slice(0, 10))) dt.setUTCDate(dt.getUTCDate() + 1);
  const d = dt.toISOString().slice(0, 10);
  return d <= today ? d : today;
}

/** Produits utilisés dans au moins une saisie (non supprimables). */
const usedProducts = () => new Set([...suivi.investments, ...suivi.valuations].flatMap(e => e.lines.map(l => l.productId)));

// ---------- Affichage ----------

export function render() {
  if (!ctx) return;
  const prefs = ctx.getPrefs();
  const today = ctx.today();
  const started = Boolean(suivi.startDate);
  $('suiviMain').classList.toggle('hidden', !started);
  $('lastExport').textContent = lastExportDate()
    ? `Dernière sauvegarde : ${fmtDate(lastExportDate())}.` : 'Aucune sauvegarde pour l\'instant.';
  if (!started) {
    $('suiviSetup').classList.remove('hidden');
    $('setupPfBlock').classList.remove('hidden');
    $('startInput').value ||= today;
    if (!$('setupPf').childElementCount) renderPfEditor($('setupPf'), suivi.products);
    return;
  }
  $('suiviSetup').classList.add('hidden');

  const inv = flatInvestments(suivi), vals = flatValuations(suivi);
  const months = trackedMonths(suivi.startDate, today, prefs.day, inv);
  const rc = recoCtx();
  const recommended = months.map(m => recommendedFor(m, rc));
  const obj = objectiveStats({ months, investments: inv, budget: prefs.budget, recommended });
  const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${value}</div></div>`;

  // --- Prochain investissement (montant réparti par produit) ---
  const cur = monthOf(today);
  const doneThisMonth = inv.some(i => monthOf(i.date) === cur);
  const nextMonth = doneThisMonth ? addMonths(cur, 1) : cur;
  const nextDate = investDateOf(nextMonth, prefs.day);
  const nextReco = recommendedFor(nextMonth, rc);
  const overdue = !doneThisMonth && today > nextDate;
  $('nextInvest').innerHTML = `<div class="k muted small">${overdue ? 'Investissement du mois (pas encore saisi)' : 'Prochain investissement'}</div>` +
    `<div><strong>Le ${fmtDate(nextDate)}</strong>` +
    (isWeekend(nextDate) ? ' <span class="muted small">(week-end : prochain jour ouvrable)</span>' : '') + '</div>' +
    (nextReco ? `<div class="next-amount">${fmtCHF(nextReco.amount)}<span class="muted small">${nextReco.estimate ? ' estimation' : ''}</span></div>` +
      (suivi.products.length > 1 ? `<div class="small">${splitAmount(nextReco.amount, suivi.products).map(l => `${esc(productName(l.productId))} <strong>${fmtCHF(l.amount)}</strong>`).join(' · ')}</div>` : '')
      : '');
  $('suiviParams').textContent = `Suivi depuis le ${fmtDate(suivi.startDate)} · budget moyen ${fmtCHF(prefs.budget)} · le ${prefs.day} du mois`;

  // --- Portefeuille : part cible et part réelle au dernier relevé ---
  const perfP = productPerformance(suivi);
  const lastVal = [...vals].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  $('pfView').innerHTML = `<table class="compact"><tr><th>Produit</th><th class="num">Cible</th><th class="num">Réel${lastVal ? ` <span class="muted">(${fmtDate(lastVal.date).slice(0, 5)})</span>` : ''}</th></tr>` +
    perfP.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${pctLabel(p.targetPct)}</td>` +
      `<td class="num ${p.weight != null && Math.abs(p.weight * 100 - p.targetPct) > 5 ? 'neg' : ''}">${p.weight == null ? '—' : pctLabel(Math.round(p.weight * 1000) / 10)}</td></tr>`).join('') +
    '</table>' + (lastVal ? '' : '<p class="small muted">La part réelle apparaîtra avec ton premier relevé de valeur.</p>');

  // --- Respect de l'objectif ---
  if (!obj.N) {
    const startMonth = monthOf(suivi.startDate);
    const firstMonth = suivi.startDate > investDateOf(startMonth, prefs.day) ? addMonths(startMonth, 1) : startMonth;
    $('kpiObjective').innerHTML = `<p class="small">Ton premier investissement est prévu le ${fmtDate(investDateOf(firstMonth, prefs.day))}. ` +
      'Les indicateurs apparaîtront à partir de là.</p>';
    $('missedList').textContent = '';
  } else {
    $('kpiObjective').innerHTML =
      kpi('Mois écoulés', obj.N) +
      kpi('Total investi', fmtCHF(obj.total)) +
      kpi('Moyenne réelle / mois', fmtCHF(Math.round(obj.avg))) +
      kpi('Écart à l\'objectif', `${signed(Math.round(obj.gap), fmtCHF)} <span class="muted small">(${signed(obj.gapPct, x => fmtPct(x))})</span>`, obj.gap < 0 ? 'neg' : 'pos') +
      kpi('Recommandé (modèle)', obj.recommendedMonths ? `${fmtCHF(obj.totalRecommended)}<br><span class="muted small">moy. ${fmtCHF(Math.round(obj.avgRecommended))}</span>` : '—') +
      kpi('Réserve théorique', fmtCHF(Math.round(obj.reserve)), 'wide ' + (obj.reserve >= 0 ? 'pos' : 'neg'));
    $('missedList').innerHTML = (obj.reserve >= 0
      ? 'Réserve positive : c\'est le cash à garder de côté pour les paliers élevés.'
      : 'Réserve négative : tu as investi plus que ton budget moyen.') +
      (obj.missed.length ? `<br>Mois sans saisie : ${obj.missed.map(fmtMonth).join(', ')}.` : '<br>Aucun mois manqué.');
  }

  // --- Comparaison des DCA ---
  renderCompare(months, recommended, prefs, inv);

  // --- Performance : globale puis par produit ---
  const perf = performance(inv, vals);
  $('perf').innerHTML = perf
    ? `<p class="small muted">Au relevé du ${fmtDate(perf.date)}, nets de frais.</p><div class="kpis">` +
      kpi('Valeur', fmtCHF(Math.round(perf.value))) +
      kpi('Investi + frais', fmtCHF(Math.round(perf.invested + perf.fees))) +
      kpi('Plus-value', signed(Math.round(perf.gain), fmtCHF), perf.gain >= 0 ? 'pos' : 'neg') +
      kpi('Rendement simple', signed(perf.simple, x => fmtPct(x)), perf.simple >= 0 ? 'pos' : 'neg') +
      kpi('Rendement annualisé (TRI)', perf.xirr == null ? '—' : signed(perf.xirr, x => fmtPct(x)) +
        (perf.shortHistory ? '<br><span class="muted small">peu significatif sur moins d\'un an</span>' : ''), 'wide') +
      '</div>'
    : '<p class="small">Ajoute un <strong>relevé de valeur</strong> (la valeur de chaque ligne indiquée par ton courtier) pour voir ta performance.</p>';
  $('perfProducts').innerHTML = perf && suivi.products.length > 1
    ? `<h3>Par produit</h3><div class="scroll-x"><table class="compact"><tr><th>Produit</th><th class="num">Investi</th><th class="num">Valeur</th><th class="num">Gain</th><th class="num">TRI</th></tr>` +
      perfP.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${fmtNum(p.invested + p.fees, 0)}</td>` +
        `<td class="num">${p.value == null ? '—' : fmtNum(p.value, 0)}</td>` +
        `<td class="num ${p.gain == null ? '' : p.gain >= 0 ? 'pos' : 'neg'}">${p.gain == null ? '—' : signed(Math.round(p.gain), x => fmtNum(x, 0))}</td>` +
        `<td class="num">${p.xirr == null ? '—' : signed(p.xirr, x => fmtPct(x))}</td></tr>`).join('') +
      '</table></div><p class="small muted">Investi : frais inclus, répartis au prorata des montants. Chaque produit est évalué à son dernier relevé.</p>'
    : '';

  // --- Frais ---
  const fees = feeStats(inv);
  $('kpiFees').innerHTML = kpi('Total des frais', fmtCHF2(fees.total)) +
    kpi('En % de l\'investi', fmtPct(fees.pct, 2)) + kpi('Moyenne par investissement', fmtCHF2(fees.avg));

  // --- Graphiques ---
  renderCharts(months, obj, recommended, prefs, inv, vals);

  // --- Tableau mensuel ---
  $('monthlySummary').textContent = `Détail mois par mois (${months.length} mois)`;
  $('monthlyTable').innerHTML = '<tr><th>Mois</th><th class="num">DD</th><th class="num">Recom.</th><th class="num">Réel</th><th class="num">Frais</th></tr>' +
    months.slice().reverse().map((m, k) => {
      const r = recommended[months.length - 1 - k];
      const its = inv.filter(i => monthOf(i.date) === m);
      const real = its.reduce((s, i) => s + i.amount, 0), f = its.reduce((s, i) => s + i.fees, 0);
      return `<tr><td>${m.slice(5)}/${m.slice(2, 4)}</td><td class="num">${r ? fmtDD(r.dd) : '—'}</td>` +
        `<td class="num">${r ? (r.estimate ? '≈ ' : '') + fmtNum(r.amount, 0) : '—'}</td>` +
        `<td class="num ${its.length ? '' : 'neg'}">${its.length ? fmtNum(real, 0) : 'manqué'}</td><td class="num">${f ? fmtNum(f, 2) : '—'}</td></tr>`;
    }).join('');

  // --- Saisies ---
  $('entriesSummary').textContent = `Mes saisies (${suivi.investments.length} investissements, ${suivi.valuations.length} relevés)`;
  const sorted = arr => [...arr].sort((a, b) => b.date.localeCompare(a.date));
  const detail = (lines, key) => suivi.products.length > 1
    ? `<br><span class="small muted">${lines.map(l => `${esc(productName(l.productId))} ${fmtNum(l[key], 2)}`).join(' · ')}</span>` : '';
  $('invList').innerHTML = sorted(suivi.investments).map(i =>
    `<li><div><strong>${fmtCHF2(investmentTotal(i))}</strong> <span class="muted">· ${fmtDate(i.date)}${i.fees ? ` · frais ${fmtCHF2(i.fees)}` : ''}</span>` +
    detail(i.lines, 'amount') + `${i.note ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}</div>` +
    `<div class="row-actions"><button type="button" class="link" data-edit-inv="${i.id}">Modifier</button><button type="button" class="link danger" data-del-inv="${i.id}">Supprimer</button></div></li>`
  ).join('') || '<li class="muted small">Aucun investissement saisi.</li>';
  $('valList').innerHTML = sorted(suivi.valuations).map(v =>
    `<li><div><strong>${fmtCHF2(valuationTotal(v))}</strong> <span class="muted">· ${fmtDate(v.date)}</span>${detail(v.lines, 'value')}</div>` +
    `<div class="row-actions"><button type="button" class="link" data-edit-val="${v.id}">Modifier</button><button type="button" class="link danger" data-del-val="${v.id}">Supprimer</button></div></li>`
  ).join('') || '<li class="muted small">Aucun relevé saisi.</li>';
}

function renderCompare(months, recommended, prefs, inv) {
  if (!months.length || !inv.length) {
    $('compare').innerHTML = `<p class="small">Après ton premier investissement, tu verras ici comment ton DCA se situe
      face à un DCA classique de ${fmtCHF(prefs.budget)} par mois et face au DCA optimisé recommandé, sur la même période.</p>`;
    return;
  }
  const c = compareDca({ peaked: ctx.peaked, months, investments: inv, recommended, budget: prefs.budget, day: prefs.day });
  const row = (label, r, strong) => `<tr class="${strong ? 'active' : ''}"><td>${label}</td><td class="num">${fmtNum(r.invested, 0)}</td>` +
    `<td class="num">${fmtNum(r.value, 0)}</td><td class="num ${r.gain >= 0 ? 'pos' : 'neg'}">${signed(Math.round(r.gain), x => fmtNum(x, 0))}</td>` +
    `<td class="num">${r.xirr == null ? '—' : signed(r.xirr, x => fmtPct(x))}</td></tr>`;
  // Les montants investis diffèrent d'un DCA à l'autre : on compare les rendements annualisés (TRI), pas les gains en CHF.
  const pts = x => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmtNum(Math.abs(x) * 100, 1)} point${Math.abs(x * 100) >= 2 ? 's' : ''}`;
  const better = c.real.xirr != null && c.classic.xirr != null ? c.real.xirr - c.classic.xirr : null;
  const verdict = better == null ? '' :
    `<p class="verdict ${better >= 0 ? 'pos' : 'neg'}">Ton rendement annualisé : <strong>${signed(c.real.xirr, x => fmtPct(x))}</strong>, ` +
    `contre ${signed(c.classic.xirr, x => fmtPct(x))} pour le DCA classique, soit <strong>${pts(better)}</strong>` +
    `${better >= 0 ? ' en ta faveur' : ''}.</p>` +
    `<p class="small">Tu as investi ${fmtCHF(Math.round(c.real.invested))}, le DCA classique ${fmtCHF(Math.round(c.classic.invested))}` +
    (c.classic.invested > c.real.invested ? ` : la différence (${fmtCHF(Math.round(c.classic.invested - c.real.invested))}) correspond à ta réserve, gardée pour les baisses.` : '.') + '</p>';
  $('compare').innerHTML =
    `<div class="scroll-x"><table class="compact"><tr><th>CHF</th><th class="num">Investi</th><th class="num">Valeur</th><th class="num">Gain</th><th class="num">TRI</th></tr>` +
    row('Toi', c.real, true) + row('Optimisé', c.optimized) + row('Classique', c.classic) +
    `</table></div>` +
    `<p class="small muted">Toi = tes versements réels · Optimisé = montants recommandés par le modèle · ` +
    `Classique = ${fmtCHF(prefs.budget)} chaque mois, le ${prefs.day}. Tous simulés sur l'indice de référence.</p>` + verdict +
    `<p class="small muted">Valorisation à la clôture du ${fmtDate(c.classic.valueDate)}, sur ${months.length} mois. ` +
    `Chaque versement est acheté à la première clôture à partir de sa date.` +
    (c.real.pending || c.classic.pending ? ' Les versements postérieurs à la dernière clôture ne sont pas encore comptés.' : '') + '</p>' +
    (recommended.some(r => r === null) ? '<p class="small muted">Le montant recommandé n\'est pas calculable pour les mois avant le début de l\'historique fiable de l\'indice.</p>' : '');
}

function renderCharts(months, obj, recommended, prefs, inv, vals) {
  // 1. Investi cumulé : réel vs objectif (B × n) vs recommandé
  if (months.length) {
    let cr = 0, co = 0, cm = 0;
    const real = [[0, 0]], target = [[0, 0]], reco = [[0, 0]];
    months.forEach((m, k) => {
      cr += obj.byMonth.get(m) ?? 0; co += prefs.budget; cm += recommended[k]?.amount ?? 0;
      real.push([k + 1, cr]); target.push([k + 1, co]); reco.push([k + 1, cm]);
    });
    const step = Math.max(1, Math.ceil(months.length / 4));
    const xLabels = months.map((m, k) => [k + 1, `${m.slice(5)}/${m.slice(2, 4)}`]).filter((_, k) => k % step === 0 || k === months.length - 1);
    $('chartCumul').innerHTML = lineChart({
      ariaLabel: 'Investi cumulé : réel, objectif et recommandé',
      series: [
        { label: 'Réel', color: COLORS.real, points: real },
        { label: `Objectif (${fmtNum(prefs.budget, 0)} × mois)`, color: COLORS.target, points: target, dash: true },
        { label: 'Recommandé', color: COLORS.reco, points: reco },
      ],
      xLabels,
    });
  } else {
    $('chartCumul').innerHTML = '<p class="small muted">Apparaîtra après ton premier mois.</p>';
  }

  // 2. Valeur du portefeuille (relevés) vs capital investi cumulé (investissements + frais)
  if (vals.length && inv.length) {
    const ms = iso => Date.parse(iso + 'T00:00:00Z');
    const invS = [...inv].sort((a, b) => a.date.localeCompare(b.date));
    const valS = [...vals].sort((a, b) => a.date.localeCompare(b.date));
    const end = [invS.at(-1).date, valS.at(-1).date].sort().at(-1);
    let c = 0;
    const capital = [[ms(invS[0].date), 0]];
    for (const i of invS) { c += i.amount + i.fees; capital.push([ms(i.date), c]); }
    capital.push([ms(end), c]);
    $('chartValue').innerHTML = lineChart({
      ariaLabel: 'Valeur du portefeuille et capital investi',
      series: [
        { label: 'Capital investi (avec frais)', color: COLORS.target, points: capital, step: true },
        { label: 'Valeur (relevés)', color: COLORS.value, points: valS.map(v => [ms(v.date), v.value]), dots: true },
      ],
      xLabels: [[ms(invS[0].date), fmtDate(invS[0].date).slice(3)], [ms(end), fmtDate(end).slice(3)]],
    });
  } else {
    $('chartValue').innerHTML = '<p class="small muted">Apparaîtra après ton premier investissement et ton premier relevé de valeur.</p>';
  }
}

// ---------- Saisies ----------

/** Champs « un montant par produit » dans une fenêtre de saisie. */
function renderLines(container, values, label) {
  container.innerHTML = suivi.products.map(p => {
    const v = values[p.id];
    return `<label for="ln-${container.id}-${p.id}">${esc(label(p))}</label>` +
      `<input id="ln-${container.id}-${p.id}" data-product="${p.id}" type="number" inputmode="decimal" min="0" step="0.01" value="${v == null ? '' : v}">`;
  }).join('');
}
const readLines = (container, key) => [...container.querySelectorAll('input[data-product]')]
  .map(i => ({ productId: i.dataset.product, [key]: money(i.value || 0) }));
const showTotal = (container, out, prefix) => {
  const t = [...container.querySelectorAll('input[data-product]')].reduce((s, i) => s + (money(i.value || 0) || 0), 0);
  $(out).textContent = suivi.products.length > 1 ? `${prefix} : ${fmtCHF2(t)}` : '';
};

function openInvestment(id = null) {
  editing = id;
  const inv = id ? suivi.investments.find(i => i.id === id) : null;
  $('invTitle').textContent = inv ? 'Modifier l\'investissement' : 'Nouvel investissement';
  $('invDate').value = inv?.date ?? defaultInvestDate();
  $('invFees').value = inv?.fees || '';
  $('invNote').value = inv?.note ?? '';
  linesTouched = Boolean(inv);
  renderLines($('invLines'), Object.fromEntries((inv?.lines ?? []).map(l => [l.productId, l.amount])),
    p => suivi.products.length > 1 ? `${p.name} (cible ${pctLabel(p.pct)}) — CHF` : `Montant investi en ${p.name} (CHF)`);
  prefillAmounts();
  $('invDialog').showModal();
}

/** Pré-remplit les montants avec le montant recommandé du mois de la date choisie, réparti selon les parts cibles. */
function prefillAmounts() {
  const d = $('invDate').value;
  const r = d ? recommendedFor(monthOf(d), recoCtx()) : null;
  $('invHint').textContent = r ? `Recommandé pour ${fmtMonth(monthOf(d))} : ${fmtCHF(r.amount)}${r.estimate ? ' (estimation)' : ''} — DD ${fmtDD(r.dd)} à la clôture du ${fmtDate(r.closeDate)}.` : '';
  if (!linesTouched && r) {
    for (const l of splitAmount(r.amount, suivi.products)) $(`ln-invLines-${l.productId}`).value = l.amount;
  }
  showTotal($('invLines'), 'invTotal', 'Total investi');
}

function openValuation(id = null) {
  editing = id;
  const v = id ? suivi.valuations.find(x => x.id === id) : null;
  $('valTitle').textContent = v ? 'Modifier le relevé' : 'Nouveau relevé de valeur';
  $('valDate').value = v?.date ?? ctx.today();
  renderLines($('valLines'), Object.fromEntries((v?.lines ?? []).map(l => [l.productId, l.value])),
    p => suivi.products.length > 1 ? `Valeur ${p.name} (CHF)` : `Valeur totale ${p.name} (CHF)`);
  showTotal($('valLines'), 'valTotal', 'Valeur totale');
  $('valDialog').showModal();
}

function openPortfolio() {
  renderPfEditor($('dlgPf'), suivi.products, { locked: usedProducts() });
  $('pfDialog').showModal();
}

/** Liste de l'éditeur -> produits avec identifiants (on garde l'identifiant des produits existants). */
const withIds = list => list.map(p => ({ id: p.id || newId(), name: p.name, pct: p.pct }));

/** Portefeuille transmis par le lien (?p=SPYI:90,EIMI:10) : appliqué tant qu'aucune saisie n'existe. */
function applyLinkPortfolio() {
  const fromLink = parsePortfolioParam(new URLSearchParams(location.search).get('p'));
  if (!fromLink || suivi.investments.length || suivi.valuations.length) return;
  suivi.products = fromLink.map(p => ({ id: newId(), ...p }));
  saveSuivi(suivi);
}

function bindEvents() {
  $('setupForm').addEventListener('submit', e => {
    e.preventDefault();
    const products = checkPfEditor($('setupPf'));
    if (!products) return;
    suivi.startDate = $('startInput').value;
    suivi.products = withIds(products);
    persist();
  });
  $('btnEditStart').addEventListener('click', () => {
    $('startInput').value = suivi.startDate;
    $('setupPfBlock').classList.add('hidden'); // ici, seule la date de départ change
    $('suiviSetup').classList.remove('hidden');
    $('suiviSetup').scrollIntoView({ behavior: 'smooth' });
  });
  $('btnEditPf').addEventListener('click', openPortfolio);
  $('btnAddInv').addEventListener('click', () => openInvestment());
  $('btnAddVal').addEventListener('click', () => openValuation());
  $('invDate').addEventListener('change', prefillAmounts);
  $('invLines').addEventListener('input', () => { linesTouched = true; showTotal($('invLines'), 'invTotal', 'Total investi'); });
  $('valLines').addEventListener('input', () => showTotal($('valLines'), 'valTotal', 'Valeur totale'));
  for (const b of document.querySelectorAll('dialog [data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

  $('invForm').addEventListener('submit', e => {
    const lines = readLines($('invLines'), 'amount').filter(l => l.amount > 0);
    const fees = money($('invFees').value || 0);
    if (!$('invDate').value || !lines.length || !(fees >= 0)) { e.preventDefault(); $('invTotal').textContent = 'Indique au moins un montant.'; return; }
    const entry = { id: editing ?? newId(), date: $('invDate').value, fees, note: $('invNote').value.trim(), lines };
    suivi.investments = suivi.investments.filter(i => i.id !== entry.id).concat(entry);
    persist();
  });
  $('valForm').addEventListener('submit', e => {
    const lines = readLines($('valLines'), 'value').filter(l => l.value > 0);
    if (!$('valDate').value || !lines.length) { e.preventDefault(); $('valTotal').textContent = 'Indique au moins une valeur.'; return; }
    const entry = { id: editing ?? newId(), date: $('valDate').value, lines };
    suivi.valuations = suivi.valuations.filter(v => v.id !== entry.id).concat(entry);
    persist();
  });
  $('pfForm').addEventListener('submit', e => {
    const products = checkPfEditor($('dlgPf'));
    if (!products) { e.preventDefault(); return; }
    const kept = new Set(products.map(p => p.id).filter(Boolean));
    if ([...usedProducts()].some(id => !kept.has(id))) { e.preventDefault(); return; }
    suivi.products = withIds(products);
    persist();
  });

  // Modifier / supprimer (délégation d'événements sur les listes)
  document.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.editInv) openInvestment(t.dataset.editInv);
    if (t.dataset.editVal) openValuation(t.dataset.editVal);
    if (t.dataset.delInv && confirm('Supprimer cet investissement ?')) { suivi.investments = suivi.investments.filter(i => i.id !== t.dataset.delInv); persist(); }
    if (t.dataset.delVal && confirm('Supprimer ce relevé ?')) { suivi.valuations = suivi.valuations.filter(v => v.id !== t.dataset.delVal); persist(); }
  });

  // Sauvegarde
  $('btnExport').addEventListener('click', async () => {
    const p = ctx.getPrefs();
    const text = exportData({ prefs: { budget: p.budget, day: p.day, name: p.name ?? null }, suivi });
    const name = `dca-suivi-${ctx.today()}.json`;
    const file = new File([text], name, { type: 'application/json' });
    try {
      // Sur téléphone : feuille de partage (iCloud, Drive, e-mail…) ; sinon téléchargement classique.
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Sauvegarde DCA optimisé' });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      markExported(ctx.today());
      render();
    } catch (err) {
      if (err?.name !== 'AbortError') alert(`Export impossible : ${err.message}`);
    }
  });
  $('importInput').addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = importData(await f.text());
      const n = d.suivi.investments.length, v = d.suivi.valuations.length;
      if (!confirm(`Remplacer le suivi de cet appareil par la sauvegarde (${n} investissements, ${v} relevés) ?`)) return;
      suivi = d.suivi;
      if (d.prefs?.budget && d.prefs?.day) ctx.setPrefs({ budget: d.prefs.budget, day: d.prefs.day });
      persist();
      alert('Sauvegarde importée.');
    } catch (err) {
      alert(`Import impossible : ${err.message}`);
    }
  });
}

/** Appelé par app.js une fois les données de l'indice chargées. */
export function initSuivi(context) {
  const first = !ctx;
  ctx = context;
  if (first) {
    if (!storageAvailable()) $('suiviStorageWarn').classList.remove('hidden');
    applyLinkPortfolio();
    bindEvents();
  }
  render();
  ctx.onProductsChange?.();
}
