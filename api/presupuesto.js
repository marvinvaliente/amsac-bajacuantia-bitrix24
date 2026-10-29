// Disponibilidad presupuestaria para la Certificación presupuestaria.
//
// Lo aprobado vive en el sistema "Presupuesto 2027" (esquema `presupuesto` del
// MISMO proyecto Supabase: presupuesto.bc_presupuestos / bc_items). Esta app
// solo LEE ese esquema: todo aumento, disminución o cambio de específicos lo
// hace el Departamento de Presupuesto desde allá y se refleja aquí al
// instante, sin copiar datos.
//
// Reglas:
//  - Solo cuenta lo que está en estado 'aprobado' y no 'quitado'.
//  - El año del presupuesto es el año del fondo de la solicitud
//    (gastos_fondos.anio): cuando se cree el fondo 2028 y Presupuesto cargue
//    el 2028, esta app pasa a usarlo sola.
//  - Si para ese año Presupuesto todavía NO tiene ningún presupuesto de baja
//    cuantía cargado (p. ej. el fondo 2026), el control no se aplica.
//  - Unidad = departamento de Bitrix24 del "Área solicitante" (se busca por
//    nombre, sin distinguir mayúsculas ni tildes).
//  - Fondo: caja_chica -> 'caja_chica'; circulante -> 'fondo_circulante' (+
//    'fondo_flotas' si esa unidad lo tiene).
//  - Comprometido = ítems de solicitudes ya certificadas, desembolsadas o
//    facturadas, del mismo tipo de fondo, año y unidad.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET;

const ESTADOS_COMPROMETEN = ['certificado', 'desembolsado', 'facturado'];
const CLAVES_BC = { caja_chica: ['caja_chica'], circulante: ['fondo_circulante', 'fondo_flotas'] };

function sb(path, schema) {
  const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  if (schema) headers['Accept-Profile'] = schema;
  return fetch(URL + '/rest/v1/' + path, { headers });
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function round2(n) { return Math.round(n * 100) / 100; }

async function leer(path, schema) {
  const r = await sb(path, schema);
  const d = await r.json();
  if (!r.ok) throw new Error((d && (d.message || d.error)) || ('Error al leer ' + path));
  return d;
}

// Devuelve { activo, motivo, anio, unidad, fondo_tipo, especificos: [{codigo,
// aprobado, comprometido, disponible}] }. `solicitud` (opcional) excluye a esa
// solicitud del comprometido, para poder recertificarla sin contarla dos veces.
async function disponibilidad(fondoId, area, areaId, excluirSolicitudId) {
  const fondos = await leer('gastos_fondos?id=eq.' + encodeURIComponent(fondoId) + '&select=id,tipo,anio');
  if (!fondos[0]) return { activo: false, motivo: 'fondo_inexistente' };
  const fondo = fondos[0];
  const base = { anio: fondo.anio, fondo_tipo: fondo.tipo };

  const claves = CLAVES_BC[fondo.tipo] || [];
  if (!claves.length) return Object.assign(base, { activo: false, motivo: 'tipo_sin_equivalencia' });

  const hay = await leer('bc_presupuestos?anio=eq.' + fondo.anio + '&select=id&limit=1', 'presupuesto');
  if (!hay.length) return Object.assign(base, { activo: false, motivo: 'sin_presupuesto_cargado' });

  const unidades = await leer('unidades?select=id,nombre,bitrix_departamento_id', 'presupuesto');
  const nArea = norm(area);
  const unidad = (areaId && unidades.find((u) => String(u.bitrix_departamento_id) === String(areaId))) ||
    unidades.find((u) => norm(u.nombre) === nArea);
  if (!unidad) return Object.assign(base, { activo: true, motivo: 'unidad_sin_presupuesto', especificos: [] });
  base.unidad = unidad.nombre;

  const pres = await leer(
    'bc_presupuestos?unidad_id=eq.' + unidad.id + '&anio=eq.' + fondo.anio +
    '&fondo=in.(' + claves.join(',') + ')&select=id,fondo,estado', 'presupuesto');
  const aprobados = pres.filter((p) => p.estado === 'aprobado');
  if (!aprobados.length) {
    return Object.assign(base, { activo: true, motivo: pres.length ? 'no_aprobado' : 'unidad_sin_presupuesto', especificos: [] });
  }

  const items = await leer(
    'bc_items?presupuesto_id=in.(' + aprobados.map((p) => p.id).join(',') + ')&quitado=eq.false&select=especifico,monto', 'presupuesto');
  const aprobado = {};
  items.forEach((i) => { aprobado[i.especifico] = round2((aprobado[i.especifico] || 0) + Number(i.monto || 0)); });

  // Comprometido: solicitudes del mismo tipo de fondo y año, misma unidad.
  const fondosMismos = await leer('gastos_fondos?tipo=eq.' + fondo.tipo + '&anio=eq.' + fondo.anio + '&select=id');
  const ids = fondosMismos.map((f) => f.id);
  const comprometido = {};
  if (ids.length) {
    const sols = await leer(
      'gastos_solicitudes?fondo_id=in.(' + ids.join(',') + ')&estado=in.(' + ESTADOS_COMPROMETEN.join(',') +
      ')&select=id,area_solicitante,items');
    sols.forEach((s) => {
      if (excluirSolicitudId && String(s.id) === String(excluirSolicitudId)) return;
      if (norm(s.area_solicitante) !== norm(unidad.nombre) && norm(s.area_solicitante) !== nArea) return;
      (Array.isArray(s.items) ? s.items : []).forEach((it) => {
        const e = String(it.especifico_presupuestario || '').trim();
        if (e) comprometido[e] = round2((comprometido[e] || 0) + Number(it.total || 0));
      });
    });
  }

  const codigos = Object.keys(aprobado).concat(Object.keys(comprometido).filter((c) => !(c in aprobado)));
  const especificos = codigos.sort().map((c) => ({
    codigo: c, aprobado: aprobado[c] || 0, comprometido: comprometido[c] || 0,
    disponible: round2((aprobado[c] || 0) - (comprometido[c] || 0))
  }));
  return Object.assign(base, { activo: true, motivo: 'ok', especificos: especificos });
}

// Valida los ítems de una solicitud contra la disponibilidad. Devuelve null si
// está bien o un texto de error legible.
async function validarCertificacion(fondoId, area, areaId, items, solicitudId) {
  const d = await disponibilidad(fondoId, area, areaId, solicitudId);
  if (!d.activo) return null;
  const etiqueta = 'la unidad "' + (d.unidad || area) + '"';
  if (d.motivo === 'unidad_sin_presupuesto') {
    return 'No hay presupuesto de baja cuantía ' + d.anio + ' para ' + etiqueta + ' en el sistema Presupuesto.';
  }
  if (d.motivo === 'no_aprobado') {
    return 'El presupuesto de baja cuantía ' + d.anio + ' de ' + etiqueta + ' todavía no está aprobado por el Departamento de Presupuesto.';
  }
  const pedido = {};
  items.forEach((it) => {
    const e = String(it.especifico_presupuestario || '').trim();
    pedido[e] = round2((pedido[e] || 0) + Number(it.total || 0));
  });
  const problemas = [];
  Object.keys(pedido).forEach((e) => {
    const fila = d.especificos.find((x) => x.codigo === e);
    if (!fila || fila.aprobado <= 0) {
      problemas.push('El específico ' + e + ' no tiene monto aprobado para ' + etiqueta + ' en ' + d.anio + '.');
    } else if (pedido[e] > fila.disponible + 0.001) {
      problemas.push('Específico ' + e + ': se piden $' + pedido[e].toFixed(2) + ' pero solo hay $' +
        Math.max(fila.disponible, 0).toFixed(2) + ' disponibles (aprobado $' + fila.aprobado.toFixed(2) +
        ', ya comprometido $' + fila.comprometido.toFixed(2) + ').');
    }
  });
  return problemas.length ? 'No se puede certificar, supera lo aprobado por Presupuesto. ' + problemas.join(' ') : null;
}

// ---- Quién pertenece a un departamento de Bitrix24 ----
// La certificación presupuestaria y la autorización de reintegros las hace el
// personal del Departamento de Presupuesto; Tesorería (liberar fondos, subir
// acuerdo y comprobante) es el personal del Departamento de Tesorería. En
// ambos casos incluye al jefe del departamento. Se verifica en el servidor con
// el webhook de Bitrix24 (BITRIX24_WEBHOOK_URL), no con lo que diga el navegador.
async function bx(method, params) {
  const hook = process.env.BITRIX24_WEBHOOK_URL;
  if (!hook) throw new Error('Falta configurar BITRIX24_WEBHOOK_URL en el servidor.');
  const base = hook.endsWith('/') ? hook : hook + '/';
  const r = await fetch(base + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Bitrix24 (' + method + '): ' + (j.error_description || j.error || r.status));
  return j;
}
const cacheDeptos = {};
// Departamento de Bitrix24 por nombre (normalizado, sin tildes). Cache de 5 min.
async function deptoPorNombre(nombreNorm) {
  const c = cacheDeptos[nombreNorm];
  if (c && Date.now() - c.t < 5 * 60 * 1000) return c.d;
  let start = 0, found = null;
  for (let i = 0; i < 20 && !found; i++) {
    const j = await bx('department.get', { start });
    found = (j.result || []).find((d) => norm(d.NAME) === nombreNorm) || null;
    if (j.next == null) break;
    start = j.next;
  }
  if (!found) throw new Error('No se encontró en Bitrix24 el departamento "' + nombreNorm + '".');
  const d = { id: String(found.ID), head: found.UF_HEAD && String(found.UF_HEAD) !== '0' ? String(found.UF_HEAD) : '' };
  cacheDeptos[nombreNorm] = { t: Date.now(), d };
  return d;
}
// true si el usuario (activo) es miembro del departamento o su jefe. Lanza
// error si no se puede consultar Bitrix24 (no se asume permiso).
async function esPersonalDepto(userId, nombreNorm) {
  userId = String(userId || '').trim();
  if (!userId) return false;
  const d = await deptoPorNombre(nombreNorm);
  const j = await bx('user.get', { FILTER: { ID: userId } });
  const u = (j.result || [])[0];
  if (!u || u.ACTIVE === false) return false;
  return userId === d.head || (u.UF_DEPARTMENT || []).map(String).indexOf(d.id) !== -1;
}
// Ids de los usuarios activos del departamento (miembros + jefe), para avisarles.
async function usuariosDepto(nombreNorm) {
  const d = await deptoPorNombre(nombreNorm);
  const ids = new Set();
  if (d.head) ids.add(d.head);
  let start = 0;
  for (let i = 0; i < 20; i++) {
    const j = await bx('user.get', { FILTER: { UF_DEPARTMENT: d.id, ACTIVE: true }, start });
    (j.result || []).forEach((u) => ids.add(String(u.ID)));
    if (j.next == null) break;
    start = j.next;
  }
  return Array.from(ids);
}
const esPersonalPresupuesto = (userId) => esPersonalDepto(userId, 'departamento de presupuesto');
const esPersonalTesoreria = (userId) => esPersonalDepto(userId, 'departamento de tesoreria');
const usuariosTesoreria = () => usuariosDepto('departamento de tesoreria');

// Administrador del portal, verificado contra Bitrix24: el navegador manda el
// token de su sesión (BX24.getAuth) y se le pregunta a Bitrix24 quién es y si es
// administrador (método profile). Un actor_is_admin escrito a mano no sirve.
// Cualquier fallo se trata como "no es administrador".
const cacheAdmin = {};
async function esAdminPortal(userId, token) {
  userId = String(userId || '').trim();
  token = String(token || '').trim();
  if (!userId || !token || !process.env.BITRIX24_WEBHOOK_URL) return false;
  const k = userId + ':' + token;
  const c = cacheAdmin[k];
  if (c && Date.now() - c.t < 2 * 60 * 1000) return c.v;
  let v = false;
  try {
    // (en este archivo "URL" es la de Supabase: se usa la clase de Node explícita)
    const origin = new (require('url').URL)(process.env.BITRIX24_WEBHOOK_URL).origin;
    const r = await fetch(origin + '/rest/profile.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: token }) });
    const j = await r.json().catch(() => ({}));
    const p = j && j.result;
    v = !!(r.ok && p && String(p.ID) === userId && (p.ADMIN === true || p.ADMIN === 'true' || p.ADMIN === 'Y'));
  } catch (e) { v = false; }
  cacheAdmin[k] = { t: Date.now(), v };
  return v;
}
// Diagnóstico para la pantalla: dice si el servidor reconoce al usuario como administrador del portal y, si no,
// por qué (sin token, token rechazado, usuario distinto, no es administrador...). No usa caché.
async function diagnosticarAdmin(userId, token) {
  userId = String(userId || '').trim();
  token = String(token || '').trim();
  if (!process.env.BITRIX24_WEBHOOK_URL) return { verificado: false, motivo: 'Falta la variable BITRIX24_WEBHOOK_URL en el servidor.' };
  if (!userId) return { verificado: false, motivo: 'La app no envió el usuario.' };
  if (!token) return { verificado: false, motivo: 'La app no envió el token de sesión de Bitrix24; abre la app desde dentro de Bitrix24.' };
  try {
    const origin = new (require('url').URL)(process.env.BITRIX24_WEBHOOK_URL).origin;
    const r = await fetch(origin + '/rest/profile.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j || !j.result) return { verificado: false, motivo: 'Bitrix24 rechazó el token de sesión (' + ((j && (j.error_description || j.error)) || ('HTTP ' + r.status)) + ').' };
    const pr = j.result;
    if (String(pr.ID) !== userId) return { verificado: false, motivo: 'El token pertenece a otro usuario (' + pr.ID + ' en vez de ' + userId + ').' };
    if (!(pr.ADMIN === true || pr.ADMIN === 'true' || pr.ADMIN === 'Y')) return { verificado: false, motivo: 'Bitrix24 indica que tu usuario no es administrador del portal.' };
    return { verificado: true, motivo: '' };
  } catch (e) { return { verificado: false, motivo: 'No se pudo consultar Bitrix24: ' + String((e && e.message) || e) }; }
}
// Certificar / revisar: personal de Presupuesto o administrador del portal.
const puedeComoPresupuesto = async (body) => (await esAdminPortal(body.actor_id, body.auth_token)) || esPersonalPresupuesto(body.actor_id);
// Liberar fondos / cerrar liquidaciones: personal de Tesorería o administrador del portal.
const puedeComoTesoreria = async (body) => (await esAdminPortal(body.actor_id, body.auth_token)) || esPersonalTesoreria(body.actor_id);

module.exports = async (req, res) => {
  if (!URL || !KEY) { res.status(500).json({ error: 'Faltan variables de entorno del servidor.' }); return; }
  try {
    const q = req.query || {};
    if (req.method !== 'GET' || (q.action || 'disponible') !== 'disponible') {
      res.status(400).json({ error: 'Acción no reconocida.' });
      return;
    }
    if (!q.fondoId) { res.status(400).json({ ok: false, error: 'Falta el fondo.' }); return; }
    const d = await disponibilidad(q.fondoId, q.area || '', q.areaId || '', q.solicitudId || '');
    res.status(200).json(Object.assign({ ok: true }, d));
  } catch (e) {
    // Si no se puede leer el esquema presupuesto no se inventa un "sin
    // control": se informa para que no se certifique a ciegas.
    res.status(500).json({ ok: false, error: 'No se pudo consultar el presupuesto aprobado: ' + String((e && e.message) || e) });
  }
};
module.exports.disponibilidad = disponibilidad;
module.exports.validarCertificacion = validarCertificacion;
module.exports.esPersonalPresupuesto = esPersonalPresupuesto;
module.exports.esPersonalTesoreria = esPersonalTesoreria;
module.exports.usuariosTesoreria = usuariosTesoreria;
module.exports.esAdminPortal = esAdminPortal;
module.exports.diagnosticarAdmin = diagnosticarAdmin;
module.exports.puedeComoPresupuesto = puedeComoPresupuesto;
module.exports.puedeComoTesoreria = puedeComoTesoreria;
