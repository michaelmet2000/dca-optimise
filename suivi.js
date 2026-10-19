// Onglet « Mon suivi » : saisies, indicateurs, comparaison des DCA, graphiques, sauvegarde.
// Les calculs sont dans lib/tracking.js (testés) ; ce fichier ne fait que l'affichage et les saisies.
import { trackedMonths, recommendedFor, objectiveStats, feeStats, performance, compareDca, exportData, importData } from './lib/tracking.js';
import { investDateOf, monthOf, addMonths, isWeekend } from './lib/model.js';
import { fmtCHF, fmtNum, fmtPct, fmtDD, fmtDate, fmtMonth } from './lib/format.js';
import { loadSuivi, saveSuivi, storageAvailable, lastExportDate, markExported, newId } from './lib/store.js';
import { lineChart } from './lib/charts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const COLORS = { real: 'var(--accent)', target: 'var(--muted)', reco: 'var(--reco)', value: 'var(--good)' };

let ctx = null;            // { state, peaked, getPrefs, setPrefs, today }
let suivi = loadSuivi();
let editing = null;        // id de la saisie en cours de modification
let amountTouched = false; // l'utilisateur a modifié le montant pré-rempli

const fmtCHF2 = v => `${fmtNum(v, 2)} CHF`;
const signed = (v, f) => (v > 0 ? '+' : '') + f(v);

function persist() {
  if (!saveSuivi(suivi)) $('suiviStorageWarn').classList.remove('hidden');
  render();
}

/** Contexte de calcul du montant recommandé. */
function recoCtx() {
  const { state: s, peaked } = ctx, p = ctx.getPrefs();
  return { peaked, tiers: s.tiers, budget: p.budget, day: p.day, nominalBudget: s.nominalBudget, roundTo: s.roundTo, validFrom: s.validFrom };
}

/** Date proposée pour un nouvel investissement : jour J du mois (jour ouvré suivant si week-end), sans dépasser aujourd'hui. */
function defaultInvestDate() {
  const today = ctx.today();
  let d = investDateOf(monthOf(today), ctx.getPrefs().day);
  const dt = new Date(d + 'T00:00:00Z');
  while (isWeekend(dt.toISOString().slice(0, 10))) dt.setUTCDate(dt.getUTCDate() + 1);
  d = dt.toISOString().slice(0, 10);
  return d <= today ? d : today;
}

// ---------- Affichage ----------

export function render() {
  if (!ctx) return;
  const prefs = ctx.getPrefs();
  const today = ctx.today();
  const started = Boolean(suivi.startDate);
  $('suiviSetup').classList.toggle('hidden', started);
  $('suiviMain').classList.toggle('hidden', !started);
  $('lastExport').textContent = lastExportDate()
    ? `Dernière sauvegarde : ${fmtDate(lastExportDate())}.` : 'Aucune sauvegarde pour l\'instant.';
  if (!started) { $('startInput').value ||= today; return; }

  const months = trackedMonths(suivi.startDate, today, prefs.day, suivi.investments);
  const rc = recoCtx();
  const recommended = months.map(m => recommendedFor(m, rc));
  const obj = objectiveStats({ months, investments: suivi.investments, budget: prefs.budget, recommended });

  // --- Prochain investissement ---
  const cur = monthOf(today);
  const doneThisMonth = suivi.investments.some(i => monthOf(i.date) === cur);
  // Mois déjà saisi -> le prochain est celui du mois suivant ; sinon celui du mois en cours (même si le jour J est passé).
  const nextMonth = doneThisMonth ? addMonths(cur, 1) : cur;
  const nextDate = investDateOf(nextMonth, prefs.day);
  const nextReco = recommendedFor(nextMonth, rc);
  const overdue = !doneThisMonth && today > nextDate;
  $('nextInvest').innerHTML = `<div class="k muted small">${overdue ? 'Investissement du mois (pas encore saisi)' : 'Prochain investissement'}</div>` +
    `<div><strong>Le ${fmtDate(nextDate)}</strong>` +
    (isWeekend(nextDate) ? ' <span class="muted small">(week-end : prochain jour ouvrable)</span>' : '') + '</div>' +
    (nextReco ? `<div class="next-amount">${fmtCHF(nextReco.amount)}<span class="muted small">${nextReco.estimate ? ' estimation' : ''}</span></div>` : '');
  $('suiviParams').textContent = `Suivi depuis le ${fmtDate(suivi.startDate)} · budget moyen ${fmtCHF(prefs.budget)} · le ${prefs.day} du mois`;

  // --- Respect de l'objectif ---
  const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${value}</div></div>`;
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
  renderCompare(months, recommended, prefs);

  // --- Performance ---
  const perf = performance(suivi.investments, suivi.valuations);
  $('perf').innerHTML = perf
    ? `<p class="small muted">Au relevé du ${fmtDate(perf.date)}, nets de frais.</p><div class="kpis">` +
      kpi('Valeur', fmtCHF(Math.round(perf.value))) +
      kpi('Investi + frais', fmtCHF(Math.round(perf.invested + perf.fees))) +
      kpi('Plus-value', signed(Math.round(perf.gain), fmtCHF), perf.gain >= 0 ? 'pos' : 'neg') +
      kpi('Rendement simple', signed(perf.simple, x => fmtPct(x)), perf.simple >= 0 ? 'pos' : 'neg') +
      kpi('Rendement annualisé (TRI)', perf.xirr == null ? '—' : signed(perf.xirr, x => fmtPct(x)) +
        (perf.shortHistory ? '<br><span class="muted small">peu significatif sur moins d\'un an</span>' : ''), 'wide') +
      '</div>'
    : '<p class="small">Ajoute un <strong>relevé de valeur</strong> (la valeur totale indiquée par ton courtier) pour voir ta performance.</p>';

  // --- Frais ---
  const fees = feeStats(suivi.investments);
  $('kpiFees').innerHTML = kpi('Total des frais', fmtCHF2(fees.total)) +
    kpi('En % de l\'investi', fmtPct(fees.pct, 2)) + kpi('Moyenne par investissement', fmtCHF2(fees.avg));

  // --- Graphiques ---
  renderCharts(months, obj, recommended, prefs);

  // --- Tableau mensuel ---
  $('monthlySummary').textContent = `Détail mois par mois (${months.length} mois)`;
  $('monthlyTable').innerHTML = '<tr><th>Mois</th><th class="num">DD</th><th class="num">Recom.</th><th class="num">Réel</th><th class="num">Frais</th></tr>' +
    months.slice().reverse().map((m, k) => {
      const r = recommended[months.length - 1 - k];
      const inv = suivi.investments.filter(i => monthOf(i.date) === m);
      const real = inv.reduce((s, i) => s + i.amount, 0), f = inv.reduce((s, i) => s + (i.fees || 0), 0);
      return `<tr><td>${m.slice(5)}/${m.slice(2, 4)}</td><td class="num">${r ? fmtDD(r.dd) : '—'}</td>` +
        `<td class="num">${r ? (r.estimate ? '≈ ' : '') + fmtNum(r.amount, 0) : '—'}</td>` +
        `<td class="num ${inv.length ? '' : 'neg'}">${inv.length ? fmtNum(real, 0) : 'manqué'}</td><td class="num">${f ? fmtNum(f, 2) : '—'}</td></tr>`;
    }).join('');

  // --- Saisies ---
  $('entriesSummary').textContent = `Mes saisies (${suivi.investments.length} investissements, ${suivi.valuations.length} relevés)`;
  const sorted = arr => [...arr].sort((a, b) => b.date.localeCompare(a.date));
  $('invList').innerHTML = sorted(suivi.investments).map(i =>
    `<li><div><strong>${fmtCHF2(i.amount)}</strong> <span class="muted">· ${fmtDate(i.date)}${i.fees ? ` · frais ${fmtCHF2(i.fees)}` : ''}</span>` +
    `${i.note ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}</div>` +
    `<div class="row-actions"><button type="button" class="link" data-edit-inv="${i.id}">Modifier</button><button type="button" class="link danger" data-del-inv="${i.id}">Supprimer</button></div></li>`
  ).join('') || '<li class="muted small">Aucun investissement saisi.</li>';
  $('valList').innerHTML = sorted(suivi.valuations).map(v =>
    `<li><div><strong>${fmtCHF2(v.value)}</strong> <span class="muted">· ${fmtDate(v.date)}</span></div>` +
    `<div class="row-actions"><button type="button" class="link" data-edit-val="${v.id}">Modifier</button><button type="button" class="link danger" data-del-val="${v.id}">Supprimer</button></div></li>`
  ).join('') || '<li class="muted small">Aucun relevé saisi.</li>';
}

function renderCompare(months, recommended, prefs) {
  if (!months.length || !suivi.investments.length) {
    $('compare').innerHTML = `<p class="small">Après ton premier investissement, tu verras ici comment ton DCA se situe
      face à un DCA classique de ${fmtCHF(prefs.budget)} par mois et face au DCA optimisé recommandé, sur la même période.</p>`;
    return;
  }
  const c = compareDca({ peaked: ctx.peaked, months, investments: suivi.investments, recommended, budget: prefs.budget, day: prefs.day });
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
    `Classique = ${fmtCHF(prefs.budget)} chaque mois, le ${prefs.day}.</p>` + verdict +
    `<p class="small muted">Valorisation à la clôture du ${fmtDate(c.classic.valueDate)}, sur ${months.length} mois. ` +
    `Chaque versement est acheté à la première clôture à partir de sa date.` +
    (c.real.pending || c.classic.pending ? ' Les versements postérieurs à la dernière clôture ne sont pas encore comptés.' : '') + '</p>' +
    (recommended.some(r => r === null) ? '<p class="small muted">Le montant recommandé n\'est pas calculable pour les mois avant le début de l\'historique fiable de l\'indice.</p>' : '');
}

function renderCharts(months, obj, recommended, prefs) {
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
  if (suivi.valuations.length && suivi.investments.length) {
    const ms = iso => Date.parse(iso + 'T00:00:00Z');
    const inv = [...suivi.investments].sort((a, b) => a.date.localeCompare(b.date));
    const vals = [...suivi.valuations].sort((a, b) => a.date.localeCompare(b.date));
    const end = [inv.at(-1).date, vals.at(-1).date].sort().at(-1);
    let c = 0;
    const capital = [[ms(inv[0].date), 0]];
    for (const i of inv) { c += i.amount + (i.fees || 0); capital.push([ms(i.date), c]); }
    capital.push([ms(end), c]);
    const first = inv[0].date;
    $('chartValue').innerHTML = lineChart({
      ariaLabel: 'Valeur du portefeuille et capital investi',
      series: [
        { label: 'Capital investi (avec frais)', color: COLORS.target, points: capital, step: true },
        { label: 'Valeur (relevés)', color: COLORS.value, points: vals.map(v => [ms(v.date), v.value]), dots: true },
      ],
      xLabels: [[ms(first), fmtDate(first).slice(3)], [ms(end), fmtDate(end).slice(3)]],
    });
  } else {
    $('chartValue').innerHTML = '<p class="small muted">Apparaîtra après ton premier investissement et ton premier relevé de valeur.</p>';
  }
}

// ---------- Saisies ----------

function openInvestment(id = null) {
  editing = id;
  const inv = id ? suivi.investments.find(i => i.id === id) : null;
  $('invTitle').textContent = inv ? 'Modifier l\'investissement' : 'Nouvel investissement';
  $('invDate').value = inv?.date ?? defaultInvestDate();
  $('invFees').value = inv?.fees || '';
  $('invNote').value = inv?.note ?? '';
  amountTouched = Boolean(inv);
  if (inv) $('invAmount').value = inv.amount; else prefillAmount();
  $('invDialog').showModal();
}

/** Pré-remplit le montant avec le montant recommandé du mois de la date choisie. */
function prefillAmount() {
  const d = $('invDate').value;
  const r = d ? recommendedFor(monthOf(d), recoCtx()) : null;
  $('invHint').textContent = r ? `Recommandé pour ${fmtMonth(monthOf(d))} : ${fmtCHF(r.amount)}${r.estimate ? ' (estimation)' : ''} — DD ${fmtDD(r.dd)} à la clôture du ${fmtDate(r.closeDate)}.` : '';
  if (!amountTouched && r) $('invAmount').value = r.amount;
}

function openValuation(id = null) {
  editing = id;
  const v = id ? suivi.valuations.find(x => x.id === id) : null;
  $('valTitle').textContent = v ? 'Modifier le relevé' : 'Nouveau relevé de valeur';
  $('valDate').value = v?.date ?? ctx.today();
  $('valValue').value = v?.value ?? '';
  $('valDialog').showModal();
}

const money = v => Math.round(Number(v) * 100) / 100;

function bindEvents() {
  $('setupForm').addEventListener('submit', e => {
    e.preventDefault();
    suivi.startDate = $('startInput').value;
    persist();
  });
  $('btnEditStart').addEventListener('click', () => {
    $('startInput').value = suivi.startDate;
    $('suiviSetup').classList.remove('hidden');
    $('suiviSetup').scrollIntoView({ behavior: 'smooth' });
  });
  $('btnAddInv').addEventListener('click', () => openInvestment());
  $('btnAddVal').addEventListener('click', () => openValuation());
  $('invDate').addEventListener('change', prefillAmount);
  $('invAmount').addEventListener('input', () => { amountTouched = true; });
  for (const b of document.querySelectorAll('dialog [data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

  $('invForm').addEventListener('submit', e => {
    const amount = money($('invAmount').value), fees = money($('invFees').value || 0);
    if (!$('invDate').value || !(amount >= 0) || !(fees >= 0)) { e.preventDefault(); return; }
    const entry = { id: editing ?? newId(), date: $('invDate').value, amount, fees, note: $('invNote').value.trim() };
    suivi.investments = suivi.investments.filter(i => i.id !== entry.id).concat(entry);
    persist();
  });
  $('valForm').addEventListener('submit', e => {
    const value = money($('valValue').value);
    if (!$('valDate').value || !(value >= 0)) { e.preventDefault(); return; }
    const entry = { id: editing ?? newId(), date: $('valDate').value, value };
    suivi.valuations = suivi.valuations.filter(v => v.id !== entry.id).concat(entry);
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
    bindEvents();
  }
  render();
}
