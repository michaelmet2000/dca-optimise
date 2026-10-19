// Stockage du suivi dans le navigateur (localStorage). Rien n'est envoyé sur internet.
// localStorage peut être indisponible (navigation privée, stockage bloqué) : try/catch partout.

const KEY = 'dca.suivi.v1';
const KEY_EXPORT = 'dca.lastExport';

export const emptySuivi = () => ({ startDate: null, investments: [], valuations: [] });

export function storageAvailable() {
  try { localStorage.setItem('__dca_test', '1'); localStorage.removeItem('__dca_test'); return true; } catch { return false; }
}

export function loadSuivi() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (!d) return emptySuivi();
    return { startDate: d.startDate ?? null, investments: d.investments ?? [], valuations: d.valuations ?? [] };
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

/** Identifiant court et unique pour une saisie. */
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
