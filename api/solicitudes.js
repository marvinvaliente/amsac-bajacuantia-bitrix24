// API de solicitudes de compra respaldada por Supabase. Mismo modelo de
// confianza que api/gastos.js y api/fondos.js: sin sesión propia, la
// identidad llega en el cuerpo/consulta.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;

function sb(path, options) {
  options = options || {};
  const headers = Object.assign(
    { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    options.headers || {}
  );
  return fetch(URL + '/rest/v1/' + path, Object.assign({}, options, { headers }));
}

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

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

const CLASIFICACIONES = ['emergente', 'imprevisto', 'recurrente'];
const FORMAS_PAGO = ['efectivo', 'transferencia', 'cheque'];
const TIPOS_ITEM = ['bien', 'servicio'];

function construirItems(items) {
  const lista = Array.isArray(items) ? items : [];
  const limpios = [];
  for (let i = 0; i < lista.length; i++) {
    const it = lista[i] || {};
    const tipo = TIPOS_ITEM.indexOf(it.tipo) !== -1 ? it.tipo : null;
    if (!tipo) return { error: 'Ítem #' + (i + 1) + ': tipo inválido (debe ser Bien o Servicio).' };
    const descripcion = String(it.descripcion || '').trim();
    if (!descripcion) return { error: 'Ítem #' + (i + 1) + ': falta la descripción.' };
    const cantidad = numOrNull(it.cantidad);
    if (cantidad == null || cantidad <= 0) return { error: 'Ítem #' + (i + 1) + ': cantidad inválida.' };
    const precioUnitario = numOrNull(it.precio_unitario);
    if (precioUnitario == null || precioUnitario < 0) return { error: 'Ítem #' + (i + 1) + ': precio unitario inválido.' };
    limpios.push({
      numero: i + 1,
      tipo: tipo,
      cantidad: cantidad,
      descripcion: descripcion,
      precio_unitario: precioUnitario,
      total: Math.round(cantidad * precioUnitario * 100) / 100
    });
  }
  if (!limpios.length) return { error: 'Agrega al menos un ítem válido.' };
  return { items: limpios };
}

function construirSolicitud(s, actorId, actorNombre) {
  s = s || {};
  const fondoId = parseInt(s.fondo_id, 10);
  if (!Number.isInteger(fondoId)) return { error: 'Debes seleccionar a qué fondo pertenece esta solicitud.' };
  const areaSolicitante = String(s.area_solicitante || '').trim();
  if (!areaSolicitante) return { error: 'Falta el área solicitante.' };
  const nombreProceso = String(s.nombre_proceso || '').trim();
  if (!nombreProceso) return { error: 'Falta el nombre del proceso.' };
  const descripcion = String(s.descripcion || '').trim();
  if (!descripcion) return { error: 'Falta la descripción.' };
  const justificacion = String(s.justificacion || '').trim();
  if (!justificacion) return { error: 'Falta la justificación.' };
  const gerenciaId = String(s.gerencia_responsable_id || '').trim();
  if (!gerenciaId) return { error: 'Falta seleccionar la gerencia responsable.' };
  const clasificacion = CLASIFICACIONES.indexOf(s.clasificacion) !== -1 ? s.clasificacion : null;
  if (!clasificacion) return { error: 'Selecciona una clasificación del gasto válida.' };
  const formaPago = FORMAS_PAGO.indexOf(s.forma_pago) !== -1 ? s.forma_pago : null;
  if (!formaPago) return { error: 'Selecciona una forma de pago válida.' };

  const itemsBuilt = construirItems(s.items);
  if (itemsBuilt.error) return { error: itemsBuilt.error };
  const montoTotal = itemsBuilt.items.reduce((acc, it) => acc + it.total, 0);

  return {
    row: {
      fondo_id: fondoId,
      area_solicitante: areaSolicitante,
      nombre_proceso: nombreProceso,
      descripcion: descripcion,
      justificacion: justificacion,
      gerencia_responsable_id: gerenciaId,
      gerencia_responsable_nombre: String(s.gerencia_responsable_nombre || '').trim(),
      clasificacion: clasificacion,
      forma_pago: formaPago,
      items: itemsBuilt.items,
      monto_total: Math.round(montoTotal * 100) / 100,
      created_by_id: String(actorId || ''),
      created_by_nombre: actorNombre || ''
    }
  };
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        const r = await sb('gastos_solicitudes?select=*&order=created_at.desc');
        res.status(200).json({ ok: r.ok, solicitudes: await r.json() });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'create') {
        const built = construirSolicitud(body.solicitud || {}, body.actor_id, body.actor_nombre);
        if (built.error) { res.status(400).json({ ok: false, error: built.error }); return; }
        const r = await sb('gastos_solicitudes', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(built.row)
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, raw: data }); return; }
        res.status(200).json({ ok: true, solicitud: data[0] });
        return;
      }

      res.status(400).json({ error: 'Acción POST no reconocida.' });
      return;
    }

    res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
