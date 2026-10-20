// Éditeur de portefeuille (produits + pourcentage cible), partagé par « Mon suivi » et le générateur de lien.
import { validateProducts, cleanProductName, MAX_PRODUCTS } from './portfolio.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtPctInput = v => String(Math.round(v * 100) / 100);

/**
 * Affiche l'éditeur dans `container`.
 * @param {{id?:string,name:string,pct:number}[]} products
 * @param {{locked?:Set<string>, onChange?:Function}} opts  locked = produits non supprimables (déjà utilisés dans des saisies)
 */
export function renderPfEditor(container, products, { locked = new Set(), onChange = () => {} } = {}) {
  const rows = products.length ? products : [{ name: '', pct: 100 }];
  container.innerHTML = `
    <div class="pf-rows">${rows.map(p => rowHtml(p, locked.has(p.id))).join('')}</div>
    <div class="pf-foot">
      <button type="button" class="link" data-pf-add>+ Ajouter un produit</button>
      <span class="pf-total small"></span>
    </div>
    <p class="small pf-error neg"></p>`;
  const update = () => {
    const list = readPfEditor(container);
    const total = list.reduce((s, p) => s + (p.pct || 0), 0);
    container.querySelector('.pf-total').textContent = `Total : ${fmtPctInput(total)} %`;
    container.querySelector('.pf-total').classList.toggle('neg', Math.abs(total - 100) > 0.001);
    container.querySelector('[data-pf-add]').classList.toggle('hidden', list.length >= MAX_PRODUCTS);
    container.querySelector('.pf-error').textContent = '';
    onChange(list);
  };
  container.oninput = update;
  container.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-pf-add')) {
      container.querySelector('.pf-rows').insertAdjacentHTML('beforeend', rowHtml({ name: '', pct: 0 }, false));
      container.querySelector('.pf-rows .pf-row:last-child input').focus();
    }
    if (b.hasAttribute('data-pf-del') && container.querySelectorAll('.pf-row').length > 1) b.closest('.pf-row').remove();
    update();
  };
  update();
}

function rowHtml(p, locked) {
  return `<div class="pf-row" data-id="${esc(p.id ?? '')}">
    <input type="text" maxlength="20" placeholder="Produit (ex. SPYI)" value="${esc(p.name)}" aria-label="Nom du produit">
    <input type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${p.pct ? fmtPctInput(p.pct) : ''}" aria-label="Pourcentage cible">
    <span class="pf-unit">%</span>
    <button type="button" class="link danger" data-pf-del ${locked ? 'disabled title="Produit déjà utilisé dans tes saisies"' : ''} aria-label="Retirer ce produit">✕</button>
  </div>`;
}

/** Produits saisis : [{id|null, name, pct}] (lignes vides ignorées). */
export function readPfEditor(container) {
  return [...container.querySelectorAll('.pf-row')].map(r => {
    const [name, pct] = r.querySelectorAll('input');
    return { id: r.dataset.id || null, name: cleanProductName(name.value), pct: Number(String(pct.value).replace(',', '.')) || 0 };
  }).filter(p => p.name || p.pct);
}

/** Lit et vérifie l'éditeur. Affiche l'erreur et renvoie null si le portefeuille n'est pas valide. */
export function checkPfEditor(container) {
  const list = readPfEditor(container);
  const err = validateProducts(list);
  container.querySelector('.pf-error').textContent = err ?? '';
  return err ? null : list;
}
