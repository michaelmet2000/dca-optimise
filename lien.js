// Générateur de lien personnalisé : prénom + budget -> URL ?b=…&n=… et QR code.
import { scaledAmount, tierLabels } from './lib/model.js';
import { fmtCHF } from './lib/format.js';
import { parseBudget, parseDay, cleanName } from './lib/prefs.js';

const $ = id => document.getElementById(id);
let tiers = null, nominal = 1200, roundTo = 10;

// Les paliers affichés en aperçu viennent du même fichier que la page principale.
fetch('data/state.json', { cache: 'no-cache' }).then(r => r.json()).then(s => {
  tiers = s.tiers; nominal = s.nominalBudget; roundTo = s.roundTo; update();
}).catch(() => {});

function buildLink(budget, name, day) {
  const url = new URL('./', location.href);
  url.searchParams.set('b', String(budget));
  url.searchParams.set('j', String(day));
  if (name) url.searchParams.set('n', name);
  return url.href;
}

function update() {
  const budget = parseBudget($('budget').value);
  const day = parseDay($('day').value);
  const name = cleanName($('name').value);
  if (!budget || !day) { $('result').classList.add('hidden'); return; }
  const link = buildLink(budget, name, day);
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
    $('preview').innerHTML = tiers.map((t, i) =>
      `<tr><td>${labels[i]}</td><td class="num">${fmtCHF(scaledAmount(t.amount, budget, nominal, roundTo))}</td></tr>`).join('');
  }
}

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
