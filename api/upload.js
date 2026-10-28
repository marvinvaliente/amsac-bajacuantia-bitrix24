// Sube archivos PDF (cotizaciones) a Supabase Storage. Mismo modelo de
// confianza que el resto de la app: sin sesión propia, se usa la service
// role key solo del lado del servidor. El bucket es público (igual de
// accesible que el resto de datos vía la API, que ya se lee con admin=1
// sin verificación real de rol — herramienta interna, no expuesta al
// público en general).
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;
// 'cotizaciones' (solo PDF) es el de siempre; 'comprobantes' guarda los
// documentos de Tesorería (acuerdo municipal PDF; transferencia/voucher/cheque
// en PDF o imagen).
const BUCKETS = {
  cotizaciones: ['application/pdf'],
  comprobantes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
};
const MAX_BYTES = 3 * 1024 * 1024; // ~3MB: límite práctico del payload de una function de Vercel

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const bucketsListos = {};
async function asegurarBucket(BUCKET) {
  if (bucketsListos[BUCKET]) return;
  const r = await fetch(URL + '/storage/v1/bucket', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES, allowed_mime_types: BUCKETS[BUCKET] })
  });
  if (r.ok || r.status === 400 || r.status === 409) { bucketsListos[BUCKET] = true; return; }
  const errData = await r.json().catch(() => ({}));
  throw new Error(errData.message || 'No se pudo preparar el almacenamiento de cotizaciones.');
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ ok: false, error: 'Faltan variables de entorno del servidor.' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido.' }); return; }

  try {
    const body = await readBody(req);
    const BUCKET = BUCKETS[body.bucket] ? body.bucket : 'cotizaciones';
    const filename = String(body.filename || '').trim();
    const contentType = String(body.contentType || '');
    const dataBase64 = String(body.dataBase64 || '');
    if (!filename || !dataBase64) { res.status(400).json({ ok: false, error: 'Falta el archivo.' }); return; }
    if (BUCKETS[BUCKET].indexOf(contentType) === -1) {
      res.status(400).json({ ok: false, error: BUCKET === 'comprobantes' ? 'Solo se aceptan archivos PDF o imágenes (JPG, PNG, WEBP).' : 'Solo se aceptan archivos PDF.' });
      return;
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (!buffer.length) { res.status(400).json({ ok: false, error: 'El archivo está vacío o no se pudo leer.' }); return; }
    if (buffer.length > MAX_BYTES) { res.status(400).json({ ok: false, error: 'El archivo no puede pesar más de 3 MB.' }); return; }

    await asegurarBucket(BUCKET);

    const nombreSeguro = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const path = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + nombreSeguro;

    const up = await fetch(URL + '/storage/v1/object/' + BUCKET + '/' + encodeURIComponent(path), {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': contentType },
      body: buffer
    });
    if (!up.ok) {
      const errData = await up.json().catch(() => ({}));
      res.status(500).json({ ok: false, error: errData.message || 'No se pudo subir el archivo.' });
      return;
    }

    const publicUrl = URL + '/storage/v1/object/public/' + BUCKET + '/' + encodeURIComponent(path);
    res.status(200).json({ ok: true, url: publicUrl, nombre: filename });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
