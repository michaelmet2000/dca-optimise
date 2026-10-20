// Stockage du suivi dans le navigateur (localStorage). Rien n'est envoyé sur internet.
// localStorage peut être indisponible (navigation privée, stockage bloqué) : try/catch partout.
import { migrateSuivi } from './portfolio.js';

const KEY = 'dca.suivi.v1';
const KEY_EXPORT = 'dca.lastExport';

export const emptySuivi = () => ({ startDate: null, products: [], investments: [], valuations: [] });

export function storageAvailable() {
  try { localStorage.setItem('__dca_test', '1'); localStorage.removeItem('__dca_test'); return true; } catch { return false; }
}

/** Suivi enregistré, converti au format par produit si besoin (anciennes données : un seul produit). */
export function loadSuivi() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (!d) return emptySuivi();
    if (!d.startDate && !d.investments?.length && !d.valuations?.length && !d.products?.length) return emptySuivi();
    return migrateSuivi(d);
  } catch { return emptySuivi(); }
}

export function saveSuivi(suivi) {
  try { localStorage.setItem(KEY, JSON.stringify(suivi)); return true; } catch { return false; }
}

export function lastExportDate() {
  try { return localStorage.getItem(KEY_EXPORT); } catch { return null; }
}
export function markExported(iso) {
  try { localStorage.setItem(KEY_EXPORT, iso); } catch { /* sans importance */ }
}

/** Identifiant court et unique pour une saisie ou un produit. */
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
