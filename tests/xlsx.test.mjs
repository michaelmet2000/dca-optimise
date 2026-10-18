// Test 6 (suite) : lecture de l'export .xlsx de msci.com (plan B), avec contrôle du niveau Price.
// Le fichier de test est fabriqué ici, au même format que l'export réel (aucune donnée MSCI publiée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseMsciXlsx } from '../scripts/xlsx.mjs';

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Archive ZIP (entrées compressées « deflate », comme Excel) à partir de {nom: texte}. */
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(data), nameBuf = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(h, nameBuf, comp); centrals.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Export au format msci.com : lignes « Index Level: », « Currency: », « Date | nom », puis les données. */
function msciExport(level, rows, currency = 'USD') {
  const strings = ['Index Level:', level, 'Currency:', currency, 'Date', 'MSCI ACWI IMI Index', 'Avertissement & mentions'];
  const s = t => { let i = strings.indexOf(t); if (i < 0) { strings.push(t); i = strings.length - 1; } return i; };
  const cell = (ref, v) => typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${s(v)}</v></c>`;
  const sheetRows = [
    `<row r="3">${cell('A3', 'Index Level:')}${cell('B3', level)}${cell('E3', 'Avertissement & mentions')}</row>`,
    `<row r="4">${cell('A4', 'Currency:')}${cell('B4', currency)}</row>`,
    `<row r="6">${cell('A6', 'Date')}${cell('B6', 'MSCI ACWI IMI Index')}</row>`,
    ...rows.map(([d, v], i) => `<row r="${7 + i}">${cell(`A${7 + i}`, d)}${cell(`B${7 + i}`, v)}</row>`),
  ];
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${sheetRows.join('')}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?><sst>${strings.map(t => `<si><t>${t.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
  return zip({ '[Content_Types].xml': '<Types/>', 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet });
}

test('6. Export .xlsx msci.com, niveau Price : dates et clôtures lues', () => {
  const x = parseMsciXlsx(msciExport('Price', [['2026-10-15', 2823.190812], ['2026-10-16', 2813.719972], ['1997-01-01', 496.1]]));
  assert.equal(x.level, 'Price');
  assert.equal(x.indexName, 'MSCI ACWI IMI Index');
  assert.deepEqual(x.points, [
    { date: '1997-01-01', close: 496.1 }, { date: '2026-10-15', close: 2823.190812 }, { date: '2026-10-16', close: 2813.719972 },
  ]);
});

test('6b. Export .xlsx refusé si le niveau est Net ou Gross, ou la devise n\'est pas USD', () => {
  assert.throws(() => parseMsciXlsx(msciExport('Net', [['2026-10-16', 15898]])), /Net/);
  assert.throws(() => parseMsciXlsx(msciExport('Gross', [['2026-10-16', 16000]])), /Gross/);
  assert.throws(() => parseMsciXlsx(msciExport('Price', [['2026-10-16', 2813.72]], 'EUR')), /devise/);
});

test('6c. Dates au format numéro de série Excel acceptées', () => {
  // 46311 = 2026-10-16 dans le calendrier Excel (origine 30/12/1899)
  const x = parseMsciXlsx(msciExport('Price', [[46311, 2813.72]]));
  assert.deepEqual(x.points, [{ date: '2026-10-16', close: 2813.72 }]);
});

test('6d. Fichier qui n\'est pas un .xlsx -> erreur claire', () => {
  assert.throws(() => parseMsciXlsx(Buffer.from('pas un zip')), /xlsx/);
});
