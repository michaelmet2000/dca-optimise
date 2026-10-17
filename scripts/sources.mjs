// Source de données en ligne (Node 18+, fetch intégré).
// Renvoie des points JOURNALIERS [{date:"AAAA-MM-JJ", close:Number}] triés par date.

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; dca-optimise/1.0)' };

/**
 * Yahoo Finance, API « chart » non officielle (pas de clé). Peut changer ou bloquer sans préavis.
 * Pour le MSCI World Price USD : ticker ^990100-USD-STRD. Les valeurs récentes concordent avec msci.com
 * à ~0,001 % près (arrondies au dixième) ; l'historique ancien de Yahoo est faux par endroits : on ne s'en
 * sert que pour ajouter les nouveaux jours.
 */
export async function fetchYahooDaily(ticker, fromIso) {
  const p1 = Math.floor(Date.parse(fromIso + 'T00:00:00Z') / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${p1}&period2=${p2}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res?.timestamp) throw new Error(`Yahoo : réponse inattendue (${j?.chart?.error?.description ?? 'pas de données'})`);
  const off = res.meta.gmtoffset ?? 0; // horodatage -> date locale de la place de cotation
  const closes = res.indicators.quote[0].close;
  const byDate = new Map();
  res.timestamp.forEach((t, i) => {
    const c = closes[i];
    if (c != null && c > 0) {
      const date = new Date((t + off) * 1000).toISOString().slice(0, 10);
      byDate.set(date, { date, close: Math.round(c * 100) / 100 });
    }
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
