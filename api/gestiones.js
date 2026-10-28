// API de gestiones de reembolso/reintegro o liquidación de un fondo. Una
// gestión agrupa los gastos "registrado" de un fondo en un mes específico
// (ver schema.sql para el flujo completo de estados). Mismo modelo de
// confianza que el resto de la app: sin sesión propia, la identidad llega
// en el cuerpo/consulta.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;
const BITRIX24_WEBHOOK_URL = process.env.BITRIX24_WEBHOOK_URL;
const presupuesto = require('./presupuesto');

const TIPOS_GESTION = ['reintegro', 'liquidacion'];
const TIPO_LABEL = { reintegro: 'Reintegro', liquidacion: 'Liquidación' };
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function sb(path, options) {
  options = options || {};
  const headers = Object.assign(
    { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    options.headers || {}
  );
  return fetch(URL + '/rest/v1/' + path, Object.assign({}, options, { headers }));
}

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

// ---- Bitrix24 Disk (best-effort documentado en README; requiere el scope
// "disk" en el mismo webhook que ya usa BITRIX24_WEBHOOK_URL) ----
async function bx24(method, params) {
  const base = BITRIX24_WEBHOOK_URL.endsWith('/') ? BITRIX24_WEBHOOK_URL : BITRIX24_WEBHOOK_URL + '/';
  const r = await fetch(base + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {})
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    const detalle = (data && (data.error_description || data.error)) || ('Bitrix24 respondió ' + r.status);
    throw new Error(method + ': ' + detalle);
  }
  return data.result;
}

const CARPETA_RAIZ_DISK = 'Gastos de Baja Cuantía';

async function obtenerOCrearCarpetaEnStorage(storageId, nombre) {
  const hijos = await bx24('disk.storage.getchildren', { id: storageId });
  const existente = (hijos || []).find((h) => h.TYPE === 'folder' && h.NAME === nombre);
  if (existente) return existente.ID;
  const nueva = await bx24('disk.storage.addfolder', { id: storageId, data: { NAME: nombre } });
  return nueva.ID;
}
async function obtenerOCrearSubcarpeta(folderId, nombre) {
  const hijos = await bx24('disk.folder.getchildren', { id: folderId });
  const existente = (hijos || []).find((h) => h.TYPE === 'folder' && h.NAME === nombre);
  if (existente) return existente.ID;
  const nueva = await bx24('disk.folder.addsubfolder', { id: folderId, data: { NAME: nombre } });
  return nueva.ID;
}

// Sube el PDF a una carpeta compartida (del usuario dueño del webhook, NO
// del administrador de fondo -- crear carpetas dentro del Drive personal de
// OTRO usuario no está garantizado por la API de Bitrix24), organizada en
// subcarpetas con el nombre de cada administrador de fondo:
//   "Gastos de Baja Cuantía" / <Nombre del administrador> / archivo.pdf
async function subirPdfADisk(nombreAdministrador, nombreArchivo, dataBase64) {
  if (!BITRIX24_WEBHOOK_URL) throw new Error('Falta configurar BITRIX24_WEBHOOK_URL en el servidor (variable de entorno de Vercel).');
  const storages = await bx24('disk.storage.getlist', {});
  if (!storages || !storages[0]) throw new Error('No se encontró un almacenamiento de Bitrix24 Disk disponible para el webhook.');
  const carpetaRaizId = await obtenerOCrearCarpetaEnStorage(storages[0].ID, CARPETA_RAIZ_DISK);
  const subcarpetaId = await obtenerOCrearSubcarpeta(carpetaRaizId, nombreAdministrador || 'Sin nombre');
  const archivo = await bx24('disk.folder.uploadfile', {
    id: subcarpetaId,
    data: { NAME: nombreArchivo },
    fileContent: [nombreArchivo, dataBase64],
    generateUniqueName: true
  });
  return { url: archivo.DOWNLOAD_URL || archivo.DETAIL_URL || '', nombre: archivo.NAME || nombreArchivo };
}

// Mismo mecanismo que api/solicitudes.js: notificación del sistema de
// Bitrix24 (best-effort, nunca bloquea la acción principal).
async function notificar(usuarioId, mensaje, mensajeOut, tag) {
  if (!BITRIX24_WEBHOOK_URL || !usuarioId) return;
  try {
    const base = BITRIX24_WEBHOOK_URL.endsWith('/') ? BITRIX24_WEBHOOK_URL : BITRIX24_WEBHOOK_URL + '/';
    const r = await fetch(base + 'im.notify.system.add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ USER_ID: usuarioId, MESSAGE: mensaje, MESSAGE_OUT: mensajeOut, TAG: tag })
    });
    if (!r.ok) console.error('gestiones.notificar: Bitrix24 respondió ' + r.status + ' — ' + (await r.text().catch(() => '')));
  } catch (e) {
    console.error('gestiones.notificar: error de conexión — ' + (e && e.message || e));
  }
}

function sanitizarNombreArchivo(s) {
  return String(s || '').replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function etiquetaPeriodo(g) {
  if (g.fecha_desde && g.fecha_hasta) {
    const f = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
    return 'del ' + f(g.fecha_desde) + ' al ' + f(g.fecha_hasta);
  }
  return 'de ' + (MESES[g.mes] || g.mes) + ' ' + g.anio;
}

// Caja chica: si el administrador de ese fondo tiene un reintegro ya
// entregado por Tesorería y todavía no confirmó que lo recibió, no puede usar
// el fondo. Devuelve esa gestión (o null). Lo usan solicitudes.js y gastos.js.
async function bloqueoCajaChica(fondoId, actorId) {
  if (!fondoId || !actorId) return null;
  const rF = await sb('gastos_fondos?id=eq.' + encodeURIComponent(fondoId) + '&select=tipo');
  const f = await rF.json();
  if (!rF.ok || !f[0] || f[0].tipo !== 'caja_chica') return null;
  const rG = await sb('gastos_gestiones?fondo_id=eq.' + encodeURIComponent(fondoId) + '&administrador_id=eq.' + encodeURIComponent(actorId) +
    '&estado=eq.entregado&select=id,tipo,mes,anio,fecha_desde,fecha_hasta,monto_total,acuerdo_url,acuerdo_nombre,comprobante_url,comprobante_nombre&order=created_at.asc&limit=1');
  const g = await rG.json();
  return (rG.ok && g[0]) || null;
}

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const action = q.action || 'list';

      if (action === 'list') {
        let path = 'gastos_gestiones?select=*&order=created_at.desc';
        if (q.fondoId) path += '&fondo_id=eq.' + encodeURIComponent(q.fondoId);
        if (q.estado) path += String(q.estado).indexOf(',') !== -1
          ? '&estado=in.(' + String(q.estado).split(',').map(encodeURIComponent).join(',') + ')'
          : '&estado=eq.' + encodeURIComponent(q.estado);
        if (q.tipo) path += '&tipo=eq.' + encodeURIComponent(q.tipo);
        if (q.administradorId) path += '&administrador_id=eq.' + encodeURIComponent(q.administradorId);
        const r = await sb(path);
        res.status(200).json({ ok: r.ok, gestiones: await r.json() });
        return;
      }

      res.status(400).json({ error: 'Acción GET no reconocida.' });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const action = body.action;

      if (action === 'crear') {
        const fondoId = parseInt(body.fondo_id, 10);
        const tipo = TIPOS_GESTION.indexOf(body.tipo) !== -1 ? body.tipo : null;
        const desde = String(body.fecha_desde || ''), hasta = String(body.fecha_hasta || '');
        const ids = (Array.isArray(body.gasto_ids) ? body.gasto_ids : []).map((x) => parseInt(x, 10)).filter(Number.isInteger);
        if (!Number.isInteger(fondoId)) { res.status(400).json({ ok: false, error: 'Falta el fondo.' }); return; }
        if (!tipo) { res.status(400).json({ ok: false, error: 'Selecciona si es Reintegro o Liquidación.' }); return; }
        const reFecha = /^\d{4}-\d{2}-\d{2}$/;
        if (!reFecha.test(desde) || !reFecha.test(hasta) || desde > hasta) {
          res.status(400).json({ ok: false, error: 'El rango de fechas no es válido.' }); return;
        }
        if (!ids.length) { res.status(400).json({ ok: false, error: 'Selecciona al menos un gasto.' }); return; }

        const rFondo = await sb('gastos_fondos?id=eq.' + fondoId + '&select=tipo');
        const fondoData = await rFondo.json();
        if (!rFondo.ok || !fondoData[0]) { res.status(400).json({ ok: false, error: 'El fondo no existe.' }); return; }
        const cuenta = String(body.cuenta_bancaria || '').trim();
        if (tipo === 'reintegro' && fondoData[0].tipo === 'circulante' && !cuenta) {
          res.status(400).json({ ok: false, error: 'Indica la cuenta bancaria del administrador (banco y número) para la transferencia del reintegro.' });
          return;
        }

        // Normalmente quien gestiona es el propio administrador del fondo
        // (actor_id). Un administrador de Bitrix24 puede hacerlo en nombre
        // de otro administrador de fondo (elegido en el selector de Informe
        // de Gastos) -- en ese caso administrador_id llega aparte y NO debe
        // confundirse con actor_id (quien ejecuta la acción).
        const administradorId = (body.actor_is_admin && body.administrador_id) ? String(body.administrador_id) : String(body.actor_id || '');
        const administradorNombre = (body.actor_is_admin && body.administrador_id) ? (body.administrador_nombre || '') : (body.actor_nombre || '');

        if (!body.actor_is_admin) {
          const chk = await sb(
            'gastos_fondo_usuarios?fondo_id=eq.' + encodeURIComponent(fondoId) +
            '&usuario_id=eq.' + encodeURIComponent(body.actor_id || '') + '&es_administrador=eq.true&select=id'
          );
          const chkData = await chk.json();
          if (!chk.ok || !Array.isArray(chkData) || !chkData.length) {
            res.status(403).json({ ok: false, error: 'No eres administrador de este fondo.' });
            return;
          }
        }

        const rGastos = await sb(
          'gastos_registros?id=in.(' + ids.join(',') + ')&fondo_id=eq.' + fondoId +
          '&estado=eq.registrado&fecha=gte.' + desde + '&fecha=lte.' + hasta + '&select=*'
        );
        const gastosData = await rGastos.json();
        if (!rGastos.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(gastosData) }); return; }
        if (!Array.isArray(gastosData) || gastosData.length !== ids.length) {
          res.status(400).json({ ok: false, error: 'Algunos gastos seleccionados ya no están disponibles (otra gestión, otro fondo, otra fecha o ya informados). Actualiza la lista e inténtalo de nuevo.' });
          return;
        }

        const montoTotal = gastosData.reduce((acc, g) => acc + (Number(g.monto_total) || 0), 0);
        const rGestion = await sb('gastos_gestiones', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            fondo_id: fondoId, administrador_id: administradorId, administrador_nombre: administradorNombre,
            tipo: tipo, mes: parseInt(desde.slice(5, 7), 10), anio: parseInt(desde.slice(0, 4), 10),
            fecha_desde: desde, fecha_hasta: hasta, cuenta_bancaria: cuenta || null,
            monto_total: Math.round(montoTotal * 100) / 100,
            estado: 'pendiente', created_by_id: String(body.actor_id || ''), created_by_nombre: body.actor_nombre || ''
          })
        });
        const gestionData = await rGestion.json();
        if (!rGestion.ok || !gestionData[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(gestionData) }); return; }
        const gestion = gestionData[0];

        const rUpdate = await sb('gastos_registros?id=in.(' + ids.join(',') + ')', {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: 'informado', gestion_id: gestion.id, updated_at: new Date().toISOString() })
        });
        if (!rUpdate.ok) { res.status(500).json({ ok: false, error: 'La gestión se creó pero no se pudieron actualizar todos los gastos.' }); return; }

        res.status(200).json({ ok: true, gestion: gestion, actualizados: ids.length });
        return;
      }

      if (action === 'revisar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        // Revisar/autorizar una gestión: solo personal del Departamento de
        // Presupuesto (incluido su jefe), verificado contra Bitrix24.
        try {
          if (!(await presupuesto.esPersonalPresupuesto(body.actor_id))) {
            res.status(403).json({ ok: false, error: 'Solo el personal del Departamento de Presupuesto (incluido su jefe) puede revisar y autorizar una gestión.' });
            return;
          }
        } catch (ePers) {
          res.status(502).json({ ok: false, error: 'No se pudo verificar tu pertenencia al Departamento de Presupuesto: ' + String((ePers && ePers.message) || ePers) });
          return;
        }
        const actual = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=*');
        const actualData = await actual.json();
        if (!actual.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualData) }); return; }
        if (!actualData || !actualData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (actualData[0].estado !== 'pendiente') { res.status(400).json({ ok: false, error: 'Esta gestión ya fue revisada.' }); return; }

        const pdf = body.pdf || {};
        if (!pdf.dataBase64 || !pdf.filename) { res.status(400).json({ ok: false, error: 'Falta el PDF generado.' }); return; }

        // Presupuesto puede haber editado montos de los gastos: el total de la
        // gestión se recalcula con lo que realmente quedó.
        const rSuma = await sb('gastos_registros?gestion_id=eq.' + encodeURIComponent(body.id) + '&estado=eq.informado&select=monto_total');
        const sumaData = await rSuma.json();
        if (!rSuma.ok || !Array.isArray(sumaData) || !sumaData.length) {
          res.status(400).json({ ok: false, error: 'La gestión no tiene gastos para autorizar.' });
          return;
        }
        const montoRevisado = Math.round(sumaData.reduce((a, x) => a + (Number(x.monto_total) || 0), 0) * 100) / 100;

        let subido;
        try {
          subido = await subirPdfADisk(sanitizarNombreArchivo(actualData[0].administrador_nombre), pdf.filename, pdf.dataBase64);
        } catch (e) {
          console.error('gestiones.revisar: fallo al subir el PDF a Bitrix24 Disk — ' + (e && e.message || e));
          res.status(502).json({ ok: false, error: 'No se pudo guardar el PDF en Bitrix24 Disk: ' + (e && e.message || e) });
          return;
        }

        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            estado: 'revisado', monto_total: montoRevisado, pdf_url: subido.url, pdf_nombre: subido.nombre,
            revisado_at: new Date().toISOString(), revisado_por_id: String(body.actor_id || ''), revisado_por_nombre: body.actor_nombre || ''
          })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }

        const g = data[0];
        const etiq = (TIPO_LABEL[g.tipo] || g.tipo) + ' ' + etiquetaPeriodo(g);
        await notificar(
          g.administrador_id,
          'Presupuesto revisó y autorizó tu gestión de ' + etiq + '. Imprime el comprobante para tu archivo físico; Tesorería realizará el trámite.\n' +
          (subido.url ? '[URL=' + subido.url + ']📄 Ver comprobante[/URL]' : ''),
          'Tu gestión de ' + etiq + ' fue autorizada por Presupuesto.',
          'GASTOS_GESTION_REVISADA_' + g.id
        );
        // Avisa a Tesorería (solo usuarios asignados individualmente: los
        // departamentos completos no se pueden expandir con este webhook).
        try {
          const rT = await sb('gastos_tesoreria?tipo=eq.usuario&select=valor');
          const tUsers = await rT.json();
          for (const t of (rT.ok && Array.isArray(tUsers) ? tUsers : [])) {
            await notificar(t.valor,
              'Gestión de ' + etiq + ' de ' + (g.administrador_nombre || 'un administrador de fondo') + ' autorizada por Presupuesto: ya puede registrarse en Tesorería.',
              'Gestión autorizada por Presupuesto, pendiente de Tesorería.', 'GASTOS_GESTION_TESORERIA_' + g.id);
          }
        } catch (eT) { /* best-effort */ }

        res.status(200).json({ ok: true, gestion: g });
        return;
      }

      if (action === 'registrar_tesoreria') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        if (!body.actor_is_admin && !body.actor_es_tesoreria) {
          res.status(403).json({ ok: false, error: 'Solo Tesorería o un administrador puede registrar el reintegro.' });
          return;
        }
        const rA = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=*');
        const aData = await rA.json();
        if (!rA.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(aData) }); return; }
        const ges = aData && aData[0];
        if (!ges) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (ges.tipo !== 'reintegro') { res.status(400).json({ ok: false, error: 'Esto aplica solo a reintegros.' }); return; }
        if (ges.estado !== 'revisado') { res.status(400).json({ ok: false, error: 'Esta gestión todavía no fue autorizada por Presupuesto, o Tesorería ya la registró.' }); return; }

        const prefijo = URL + '/storage/v1/object/public/comprobantes/';
        const acuerdo = body.acuerdo || {}, comp = body.comprobante || {};
        if (!String(acuerdo.url || '').startsWith(prefijo)) { res.status(400).json({ ok: false, error: 'Falta subir el acuerdo municipal (PDF).' }); return; }
        if (!String(comp.url || '').startsWith(prefijo)) { res.status(400).json({ ok: false, error: 'Falta subir el comprobante (transferencia, voucher o cheque).' }); return; }

        const rF = await sb('gastos_fondos?id=eq.' + encodeURIComponent(ges.fondo_id) + '&select=tipo');
        const fData = await rF.json();
        const esCajaChica = !!(fData && fData[0] && fData[0].tipo === 'caja_chica');
        const ahora = new Date().toISOString();
        const patch = {
          acuerdo_url: acuerdo.url, acuerdo_nombre: acuerdo.nombre || 'Acuerdo municipal',
          comprobante_url: comp.url, comprobante_nombre: comp.nombre || 'Comprobante',
          tesoreria_at: ahora, tesoreria_por_id: String(body.actor_id || ''), tesoreria_por_nombre: body.actor_nombre || ''
        };
        // Fondo circulante: la transferencia ya se hizo, se cierra. Caja
        // chica: queda pendiente de que el administrador confirme que recibió.
        if (esCajaChica) {
          patch.estado = 'entregado';
        } else {
          patch.estado = 'cerrado'; patch.cerrado_at = ahora;
          patch.cerrado_por_id = String(body.actor_id || ''); patch.cerrado_por_nombre = body.actor_nombre || '';
        }
        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        const etiq = (TIPO_LABEL[ges.tipo] || ges.tipo) + ' ' + etiquetaPeriodo(ges);
        await notificar(
          ges.administrador_id,
          esCajaChica
            ? 'Tesorería entregó tu ' + etiq + ' (acuerdo municipal y voucher/cheque). Entra a la app y confirma que lo recibiste: mientras no lo hagas no podrás usar la caja chica.'
            : 'Tesorería realizó la transferencia de tu ' + etiq + ' (acuerdo municipal y comprobante cargados).',
          esCajaChica ? 'Confirma que recibiste tu reintegro de caja chica.' : 'Tu reintegro fue transferido.',
          'GASTOS_GESTION_TESORERIA_OK_' + ges.id
        );
        res.status(200).json({ ok: true, gestion: data[0] });
        return;
      }

      if (action === 'confirmar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        const rC = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=estado,administrador_id');
        const cData = await rC.json();
        if (!rC.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(cData) }); return; }
        if (!cData || !cData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (!body.actor_is_admin && String(cData[0].administrador_id) !== String(body.actor_id || '')) {
          res.status(403).json({ ok: false, error: 'Solo el administrador del fondo (o un administrador del portal) puede confirmar la recepción.' });
          return;
        }
        if (cData[0].estado !== 'entregado') { res.status(400).json({ ok: false, error: 'Esta gestión no está pendiente de confirmar.' }); return; }
        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ estado: 'cerrado', cerrado_at: new Date().toISOString(), cerrado_por_id: String(body.actor_id || ''), cerrado_por_nombre: body.actor_nombre || '' })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        res.status(200).json({ ok: true, gestion: data[0] });
        return;
      }

      if (action === 'cerrar') {
        if (!body.id) { res.status(400).json({ ok: false, error: 'Falta id.' }); return; }
        if (!body.actor_is_admin && !body.actor_es_tesoreria) {
          res.status(403).json({ ok: false, error: 'Solo Tesorería o un administrador puede cerrar una gestión.' });
          return;
        }
        const actual = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id) + '&select=estado,tipo');
        const actualData = await actual.json();
        if (!actual.ok) { res.status(500).json({ ok: false, error: dbErrorMsg(actualData) }); return; }
        if (!actualData || !actualData[0]) { res.status(404).json({ ok: false, error: 'La gestión no existe.' }); return; }
        if (actualData[0].tipo !== 'liquidacion') { res.status(400).json({ ok: false, error: 'Los reintegros se cierran registrando el acuerdo municipal y el comprobante.' }); return; }
        if (actualData[0].estado !== 'revisado') { res.status(400).json({ ok: false, error: 'Esta gestión todavía no fue revisada, o ya está cerrada.' }); return; }

        const r = await sb('gastos_gestiones?id=eq.' + encodeURIComponent(body.id), {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            estado: 'cerrado', cerrado_at: new Date().toISOString(),
            cerrado_por_id: String(body.actor_id || ''), cerrado_por_nombre: body.actor_nombre || ''
          })
        });
        const data = await r.json();
        if (!r.ok || !data[0]) { res.status(500).json({ ok: false, error: dbErrorMsg(data) }); return; }
        res.status(200).json({ ok: true, gestion: data[0] });
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

module.exports.bloqueoCajaChica = bloqueoCajaChica;
