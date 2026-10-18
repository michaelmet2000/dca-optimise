// Source de données en ligne (Node 18+, fetch intégré).

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; dca-optimise/1.0)' };
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

async function chart(ticker, query) {
  const r = await fetch(`${BASE}${encodeURIComponent(ticker)}?${query}`, { headers: UA });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(`Yahoo : réponse inattendue (${j?.chart?.error?.description ?? 'pas de données'})`);
  return res;
}

/**
 * Clôtures des derniers jours d'un indice MSCI sur Yahoo Finance (API « chart » non officielle, sans clé).
 *
 * Pour le MSCI ACWI IMI (^664204-USD-STRD), Yahoo ne fournit PAS d'historique : seulement les 5 derniers
 * jours, en barres horaires (l'indice est calculé en continu, de l'ouverture de l'Asie à la clôture des
 * États-Unis). La clôture du jour D est la dernière barre de D jusqu'à 22:30 UTC : après la clôture
 * américaine (20:00 UTC en été, 21:00 UTC en hiver), la valeur reste figée jusqu'à 23:00 UTC environ, où
 * le calcul du jour suivant commence.
 *
 * Contrôle croisé : la clôture ainsi obtenue pour le dernier jour terminé doit être égale à l'une des deux
 * valeurs « officielles » que Yahoo publie à part (dernier cours ou clôture précédente). Sinon : erreur.
 *
 * @returns {Promise<{date:string, close:number}[]>} jours triés, y compris éventuellement le jour en cours
 */
export async function fetchYahooRecentCloses(ticker) {
  const res = await chart(ticker, 'interval=1h&range=5d');
  const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map();
  ts.forEach((t, i) => {
    const c = q[i];
    if (c == null || !(c > 0)) return;
    const iso = new Date(t * 1000).toISOString();
    const date = iso.slice(0, 10), hhmm = iso.slice(11, 16);
    if (hhmm > '22:30') return;               // barres du calcul suivant (ouverture asiatique)
    byDate.set(date, { date, close: Math.round(c * 100) / 100 }); // dernière barre retenue
  });
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) throw new Error('Yahoo : aucune barre horaire');

  // Valeurs de référence publiées par Yahoo (période d'un jour)
  const meta = (await chart(ticker, 'interval=1d&range=1d')).meta ?? {};
  const refs = [meta.regularMarketPrice, meta.chartPreviousClose].filter(x => x > 0).map(x => Math.round(x * 100) / 100);
  const today = new Date().toISOString().slice(0, 10);
  const lastDone = days.filter(d => d.date < today).at(-1);
  if (lastDone && !refs.some(r => Math.abs(r / lastDone.close - 1) < 0.0001)) {
    throw new Error(`Yahoo : clôture du ${lastDone.date} incohérente (${lastDone.close}, références ${refs.join(' / ')})`);
  }
  return days;
}
