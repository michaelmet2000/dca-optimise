// Lecture minimale d'un export .xlsx de msci.com (Node uniquement, sans dépendance).
// Un .xlsx est une archive ZIP de fichiers XML : on lit le répertoire central du ZIP, on décompresse
// les deux fichiers utiles (sharedStrings.xml et la première feuille) puis on extrait les cellules.
import zlib from 'node:zlib';

/** Contenu (Buffer) des fichiers de l'archive ZIP, indexé par nom. */
function unzip(buf) {
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin du fichier.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ce n'est pas un fichier .xlsx valide (archive ZIP introuvable)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('archive ZIP corrompue');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Lignes de la première feuille : tableau de { A: valeur, B: valeur, ... } (texte ou nombre).
 */
export function readXlsxRows(buf) {
  const files = unzip(buf);
  const shared = [];
  const sst = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  }
  const sheetName = [...files.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('aucune feuille dans le fichier .xlsx');
  const xml = files.get(sheetName).toString('utf8');
  const rows = [];
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, attrs, inner = ''] = c;
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (/t="s"/.test(attrs) && v != null) cells[col] = shared[Number(v)];
      else if (/t="inlineStr"/.test(attrs) && inline != null) cells[col] = decodeXml(inline);
      else if (/t="str"/.test(attrs) && v != null) cells[col] = decodeXml(v);
      else if (v != null) cells[col] = Number(v);
    }
    rows.push(cells);
  }
  return rows;
}

/** Date d'une cellule : texte "AAAA-MM-JJ" (format msci.com) ou numéro de série Excel. */
function cellDate(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Export msci.com (page de l'indice -> Performance -> Full history -> télécharger) -> clôtures.
 * Vérifie l'en-tête : « Index Level: » doit valoir Price (jamais Net ni Gross), « Currency: » USD.
 * @returns {{level:string, currency:string, indexName:string, points:{date:string, close:number}[]}}
 */
export function parseMsciXlsx(buf, { expectLevel = 'Price', expectCurrency = 'USD' } = {}) {
  const rows = readXlsxRows(buf);
  const label = key => rows.find(r => typeof r.A === 'string' && r.A.trim().toLowerCase() === key)?.B;
  const level = String(label('index level:') ?? '').trim();
  const currency = String(label('currency:') ?? '').trim();
  if (level.toLowerCase() !== expectLevel.toLowerCase()) {
    throw new Error(`fichier refusé : « Index Level » vaut « ${level || '?'} », il faut « ${expectLevel} » (jamais Net ni Gross)`);
  }
  if (currency.toUpperCase() !== expectCurrency) throw new Error(`fichier refusé : devise « ${currency || '?'} », il faut ${expectCurrency}`);
  const headerIdx = rows.findIndex(r => typeof r.A === 'string' && r.A.trim().toLowerCase() === 'date');
  if (headerIdx < 0) throw new Error('ligne « Date » introuvable');
  const indexName = String(rows[headerIdx].B ?? '').trim();
  const byDate = new Map();
  for (const r of rows.slice(headerIdx + 1)) {
    const date = cellDate(r.A);
    if (!date) continue; // lignes de pied de page éventuelles
    if (!(typeof r.B === 'number' && r.B > 0)) throw new Error(`valeur invalide le ${date} : « ${r.B} »`);
    byDate.set(date, { date, close: r.B });
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) throw new Error('aucune donnée dans le fichier');
  return { level, currency, indexName, points };
}
