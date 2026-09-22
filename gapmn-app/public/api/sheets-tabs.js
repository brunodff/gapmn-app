// Vercel serverless — lista abas via download XLSX (funciona com "Qualquer pessoa com o link")
import { promisify } from 'util';
import { inflateRaw } from 'zlib';
const inflateRawAsync = promisify(inflateRaw);

async function getSheetNamesFromXlsx(id) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!r.ok) throw new Error(`XLSX HTTP ${r.status}`);

  const buf = Buffer.from(await r.arrayBuffer());

  // Find End of Central Directory
  let eocPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocPos = i; break;
    }
  }
  if (eocPos < 0) throw new Error('Not a ZIP');

  const cdOffset = buf.readUInt32LE(eocPos + 16);
  const cdCount  = buf.readUInt16LE(eocPos + 10);

  // Walk Central Directory to find xl/workbook.xml
  let pos = cdOffset;
  let wbEntry = null;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const compression   = buf.readUInt16LE(pos + 10);
    const compressedSz  = buf.readUInt32LE(pos + 20);
    const fnLen         = buf.readUInt16LE(pos + 28);
    const extraLen      = buf.readUInt16LE(pos + 30);
    const commentLen    = buf.readUInt16LE(pos + 32);
    const localOffset   = buf.readUInt32LE(pos + 42);
    const name          = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
    if (name === 'xl/workbook.xml') {
      wbEntry = { compression, compressedSz, localOffset };
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  if (!wbEntry) throw new Error('workbook.xml not found');

  // Read local file header to get data start
  const lhFnLen    = buf.readUInt16LE(wbEntry.localOffset + 26);
  const lhExtraLen = buf.readUInt16LE(wbEntry.localOffset + 28);
  const dataStart  = wbEntry.localOffset + 30 + lhFnLen + lhExtraLen;
  const compressed = buf.slice(dataStart, dataStart + wbEntry.compressedSz);

  let xml;
  if (wbEntry.compression === 0) {
    xml = compressed.toString('utf8');
  } else {
    xml = (await inflateRawAsync(compressed)).toString('utf8');
  }

  return [...xml.matchAll(/\bsheet\b[^>]*\bname="([^"]+)"/gi)].map(m => m[1]);
}

const SKIP = /^PNCP-/i;
const SKIP_WORDS = /^(painel|resumo|dashboard|config)\b/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing param: id' });

  try {
    const all  = await getSheetNamesFromXlsx(id);
    const tabs = all.filter(n => n && !SKIP.test(n) && !SKIP_WORDS.test(n));
    return res.status(200).json({ tabs });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
