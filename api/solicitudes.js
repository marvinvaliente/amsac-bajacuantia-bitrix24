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

// Convierte la respuesta de error de Supabase/PostgREST en un texto legible
// para mostrar en el formulario, en vez de un mensaje genérico sin pistas.
function dbErrorMsg(data) {
  if (!data) return 'Error desconocido de la base de datos.';
  if (Array.isArray(data)) {
    const msg = data.map((d) => d && d.message).filter(Boolean).join('; ');
    return msg || 'Error desconocido de la base de datos.';
  }
  return data.message || data.error || data.hint || JSON.stringify(data);
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
const ESPECIFICO_RE = /^\d{5}$/;
const CEP_RE = /^\d{2}$/;

function construirItems(items, exigirPresupuestario) {
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
    // Específico Presupuestario / CEP: códigos que se asignan en la
    // certificación presupuestaria, después de creada la solicitud — por eso
    // no se piden al crearla (exigirPresupuestario=false), pero sí son
    // obligatorios al guardar cambios desde Certificación presupuestaria.
    const especifico = String(it.especifico_presupuestario || '').trim();
    if (exigirPresupuestario && !especifico) return { error: 'Ítem #' + (i + 1) + ': falta el Específico Presupuestario.' };
    if (especifico && !ESPECIFICO_RE.test(especifico)) return { error: 'Ítem #' + (i + 1) + ': Específico Presupuestario debe tener 5 dígitos.' };
    const cep = String(it.cep || '').trim();
    if (exigirPresupuestario && !cep) return { error: 'Ítem #' + (i + 1) + ': falta el CEP.' };
    if (cep && !CEP_RE.test(cep)) return { error: 'Ítem #' + (i + 1) + ': CEP debe tener 2 dígitos.' };
    limpios.push({
      numero: i + 1,
      tipo: tipo,
      cantidad: cantidad,
      descripcion: descripcion,
      precio_unitario: precioUnitario,
      especifico_presupuestario: especifico,
      cep: cep,
      total: Math.round(cantidad * precioUnitario * 100) / 100
    });
  }
  if (!limpios.length) return { error: 'Agrega al menos un ítem válido.' };
  return { items: limpios };
}

// Cotizaciones en PDF adjuntadas (ya subidas a Storage por api/upload.js;
// aquí solo se valida/sanea la lista de {url, nombre} que llega).
function construirCotizaciones(input) {
  const lista = Array.isArray(input) ? input : [];
  const limpios = [];
  for (const it of lista) {
    const url = String((it && it.url) || '').trim();
    if (!/^https:\/\//.test(url)) continue;
    limpios.push({ url: url, nombre: String((it && it.nombre) || '').trim() || 'cotizacion.pdf' });
  }
  return limpios;
}

function construirSolicitud(s, actorId, actorNombre, exigirPresupuestario, exigirCotizacion) {
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

  // Obligatorio solo al crear (exigirCotizacion=true); al certificar
  // (update) no se exige, para no bloquear solicitudes creadas antes de
  // que este campo existiera — Certificación tampoco ofrece forma de
  // agregarlas, solo las conserva de solo lectura.
  const cotizaciones = construirCotizaciones(s.cotizacion_urls);
  if (exigirCotizacion && !cotizaciones.length) return { error: 'Debes adjuntar al menos una cotización en PDF.' };

  const itemsBuilt = construirItems(s.items, exigirPresupuestario);
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
      cotizacion_urls: cotizaciones,
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
        const built = construirSolicitud(body.solicitud || {}, body.actor_id, body.actor_nombre, false, true);
        if (built.error) { res.status(400).json({ ok: false, error: built.error }); return; }
        const r = await sb('gastos_solicitudes', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(built.row)
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data), raw: data }); return; }
        res.status(200).json({ ok: true, solicitud: data[0] });
        return;
      }

      if (action === 'update') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        const actual = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id) + '&select=estado');
        const actualData = await actual.json();
        if (!actual.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualData), raw: actualData }); return; }
        if (!actualData || !actualData[0]) { res.status(404).json({ ok: false, error: 'La solicitud no existe.' }); return; }
        if (actualData[0].estado === 'eliminada' || actualData[0].estado === 'desembolsado' || actualData[0].estado === 'facturado') {
          res.status(403).json({ ok: false, error: 'No se puede editar una solicitud eliminada, ya desembolsada o ya facturada.' });
          return;
        }

        const built = construirSolicitud(body.solicitud || {}, body.actor_id, body.actor_nombre, true, false);
        if (built.error) { res.status(400).json({ ok: false, error: built.error }); return; }
        const row = built.row;
        delete row.created_by_id;
        delete row.created_by_nombre;
        // Guardar cambios aquí ya exige Específico Presupuestario/CEP en
        // todos los ítems, así que el guardado en sí certifica la solicitud.
        row.estado = 'certificado';
        const r = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row)
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data), raw: data }); return; }
        res.status(200).json({ ok: true, solicitud: data[0] });
        return;
      }

      if (action === 'delete') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        const actualD = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id) + '&select=estado');
        const actualDData = await actualD.json();
        if (!actualD.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualDData), raw: actualDData }); return; }
        if (actualDData && actualDData[0] && (actualDData[0].estado === 'desembolsado' || actualDData[0].estado === 'facturado')) {
          res.status(403).json({ ok: false, error: 'No se puede eliminar una solicitud ya desembolsada o facturada.' });
          return;
        }
        const r = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ estado: 'eliminada' })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data), raw: data }); return; }
        res.status(200).json({ ok: true, solicitud: data[0] });
        return;
      }

      if (action === 'desembolsar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        const actualE = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id) + '&select=estado,fondo_id');
        const actualEData = await actualE.json();
        if (!actualE.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualEData), raw: actualEData }); return; }
        if (!actualEData || !actualEData[0]) { res.status(404).json({ ok: false, error: 'La solicitud no existe.' }); return; }
        if (actualEData[0].estado !== 'certificado') {
          res.status(400).json({ ok: false, error: 'Solo se pueden desembolsar solicitudes certificadas.' });
          return;
        }
        if (!body.actor_is_admin) {
          const chk = await sb(
            'gastos_fondo_usuarios?fondo_id=eq.' + encodeURIComponent(actualEData[0].fondo_id) +
            '&usuario_id=eq.' + encodeURIComponent(body.actor_id || '') + '&es_administrador=eq.true&select=id'
          );
          const chkData = await chk.json();
          if (!chk.ok || !Array.isArray(chkData) || !chkData.length) {
            res.status(403).json({ ok: false, error: 'No eres administrador de este fondo, no puedes desembolsarlo.' });
            return;
          }
        }
        const r = await sb('gastos_solicitudes?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            estado: 'desembolsado',
            desembolsado_at: new Date().toISOString(),
            desembolsado_por_id: String(body.actor_id || ''),
            desembolsado_por_nombre: body.actor_nombre || ''
          })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data), raw: data }); return; }
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
