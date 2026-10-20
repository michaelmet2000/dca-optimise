// Générateur de lien personnalisé : prénom, budget, jour et portefeuille -> URL ?b=…&j=…&n=…&p=… et QR code.
import { scaledAmount, tierLabels } from './lib/model.js';
import { fmtCHF } from './lib/format.js';
import { parseBudget, parseDay, cleanName } from './lib/prefs.js';
import { portfolioParam, splitAmount, validateProducts } from './lib/portfolio.js';
import { renderPfEditor, readPfEditor } from './lib/pfeditor.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let tiers = null, nominal = 1200, roundTo = 10;

// Les paliers affichés en aperçu viennent du même fichier que la page principale.
fetch('data/state.json', { cache: 'no-cache' }).then(r => r.json()).then(s => {
  if (s.tiers) { tiers = s.tiers; nominal = s.nominalBudget; roundTo = s.roundTo; }
  update();
}).catch(() => {});

/** Portefeuille saisi, s'il est complet et valide (sinon null : le lien n'en contient pas). */
function currentPortfolio() {
  const list = readPfEditor($('pf'));
  if (!list.length) { $('pfHint').textContent = 'Laisse vide si la personne le saisira elle-même dans « Mon suivi ».'; return null; }
  const err = validateProducts(list);
  $('pfHint').textContent = err ? `${err} Le portefeuille ne sera pas inclus dans le lien.` : 'Inclus dans le lien.';
  $('pfHint').classList.toggle('neg', Boolean(err));
  return err ? null : list.map((p, i) => ({ ...p, id: `p${i + 1}` }));
}

function buildLink(budget, name, day, products) {
  const url = new URL('./', location.href);
  url.searchParams.set('b', String(budget));
  url.searchParams.set('j', String(day));
  if (name) url.searchParams.set('n', name);
  if (products) url.searchParams.set('p', portfolioParam(products));
  // « : » et « , » sont autorisés tels quels dans une adresse : lien plus lisible (p=SPYI:90,EIMI:10)
  return url.href.replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}

function update() {
  const budget = parseBudget($('budget').value);
  const day = parseDay($('day').value);
  const name = cleanName($('name').value);
  const products = currentPortfolio();
  if (!budget || !day) { $('result').classList.add('hidden'); return; }
  const link = buildLink(budget, name, day, products);
  $('result').classList.remove('hidden');
  $('link').textContent = link;
  $('open').href = link;

  // QR code (librairie qrcode-generator, MIT, copiée dans vendor/)
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });

  if (tiers) {
    const labels = tierLabels(tiers);
    $('preview').innerHTML = tiers.map((t, i) => {
      const amount = scaledAmount(t.amount, budget, nominal, roundTo);
      const split = products && products.length > 1
        ? `<br><span class="small muted">${splitAmount(amount, products).map((l, k) => `${esc(products[k].name)} ${fmtCHF(l.amount)}`).join(' · ')}</span>` : '';
      return `<tr><td>${labels[i]}</td><td class="num">${fmtCHF(amount)}${split}</td></tr>`;
    }).join('');
  }
}

renderPfEditor($('pf'), [], { onChange: () => update() });
// L'éditeur part avec une ligne « 100 % » sans nom : on vide le pourcentage pour que « vide » = pas de portefeuille.
$('pf').querySelector('input[type=number]').value = '';
$('pf').dispatchEvent(new Event('input', { bubbles: true }));
$('form').addEventListener('input', update);
$('form').addEventListener('submit', e => e.preventDefault());

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('link').textContent);
    $('copy').textContent = 'Lien copié ✓';
  } catch {
    // presse-papiers indisponible (http, ancien navigateur) : on sélectionne le texte pour copie manuelle
    const range = document.createRange(); range.selectNodeContents($('link'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    $('copy').textContent = 'Sélectionné : copie-le manuellement';
  }
  setTimeout(() => { $('copy').textContent = 'Copier le lien'; }, 2500);
});

if (navigator.share) {
  $('share').classList.remove('hidden');
  $('share').addEventListener('click', () => {
    const name = cleanName($('name').value);
    navigator.share({ title: 'DCA optimisé', text: name ? `${name}, voici ton lien DCA optimisé` : 'Ton lien DCA optimisé', url: $('link').textContent }).catch(() => {});
  });
}

update();
