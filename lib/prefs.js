// Préférences de l'utilisateur : budget, prénom, jour d'investissement.
// Source : le lien personnalisé (?b=800&n=Paul&j=25) ou la mémoire locale du navigateur.
// Rien n'est envoyé à un serveur. localStorage peut être indisponible (navigation privée) : try/catch partout.

const KEY = 'dca.prefs.v1';
export const DEFAULT_BUDGET = 1200;
export const DEFAULT_DAY = 25;
export const MIN_BUDGET = 50;
export const MAX_BUDGET = 100000;

/** Budget valide = entier entre 50 et 100 000 CHF, sinon null. Accepte "1'500" ou "1500". */
export function parseBudget(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/['’\s ]/g, ''));
  return Number.isInteger(n) && n >= MIN_BUDGET && n <= MAX_BUDGET ? n : null;
}

/** Jour d'investissement valide = entier de 1 à 31, sinon null. */
export function parseDay(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/** Prénom affichable : texte court, sans caractères de contrôle. */
export function cleanName(v) {
  if (!v) return null;
  const s = String(v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
  return s || null;
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function writeStore(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch { return false; }
}

/**
 * Préférences effectives. Les valeurs du lien sont prioritaires et sont mémorisées : ainsi l'app installée
 * sur l'écran d'accueil (qui s'ouvre sans paramètres) les retrouve.
 * @returns {{budget:number, name:string|null, day:number, fromLink:boolean, isDefault:boolean}}
 */
export function loadPrefs(search = location.search) {
  const q = new URLSearchParams(search);
  const store = readStore();
  const link = { budget: parseBudget(q.get('b')), day: parseDay(q.get('j')), name: cleanName(q.get('n')) };
  const fromLink = Boolean(link.budget || link.day || link.name);
  const prefs = {
    budget: link.budget ?? parseBudget(store.budget) ?? DEFAULT_BUDGET,
    day: link.day ?? parseDay(store.day) ?? DEFAULT_DAY,
    name: link.name ?? cleanName(store.name),
  };
  if (fromLink) writeStore({ ...store, ...prefs });
  return { ...prefs, fromLink, isDefault: !fromLink && !parseBudget(store.budget) };
}

export function savePrefs({ budget, day }) {
  return writeStore({ ...readStore(), budget, day });
}
