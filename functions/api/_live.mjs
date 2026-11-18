// Consulta en vivo a fuentes oficiales del allowlist.
// Corre en el Worker (nunca en el browser directo: CORS + secretos).
// Solo lectura. Si un sitio cae, se reporta "sitio_oficial_no_disponible".
const TIMEOUT_MS = 4500;
const cache = new Map();

function timeoutSignal(ms) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(new Error('timeout')), ms);
  return { signal: control.signal, cancel: () => clearTimeout(timer) };
}
const TTL_MS = 5 * 60 * 1000;

export function urlPara(f, q = '') {
  const base = String(f?.base || '').replace(/\/$/, '');
  if (!base || base.includes('PENDIENTE') || f?.estado === 'pendiente_lanzamiento') return null;
  const qp = encodeURIComponent(q);
  const id = String(f.id || '');
  if (f.tipo === 'ckan') return `${base}/package_search?q=${qp}&rows=5`;
  if (id.includes('indec_series')) return `${base}/search/?q=${qp}`;
  if (id.includes('bcra')) return `${base}/Monetarias/variables`;
  if (f.tipo === 'wms_wfs' || id.includes('idesa') || id.includes('ign')) {
    return `${base}?service=WMS&version=1.3.0&request=GetCapabilities`;
  }
  return base;
}

export async function consultarFuente(f, q = '', fetchFn = fetch) {
  const url = urlPara(f, q);
  if (!url) {
    return { id: f.id, estado: 'sin_url', mensaje: 'Sitio oficial pendiente de URL verificada', url: null };
  }
  const inicio = Date.now();
  const { signal, cancel } = timeoutSignal(TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      signal,
      headers: { Accept: 'application/json,text/html,application/xml' },
    });
    if (res.status === 401 || res.status === 403) {
      return { id: f.id, estado: 'requiere_login', http: res.status, url, ms: Date.now() - inicio };
    }
    if (res.status >= 500) {
      return { id: f.id, estado: 'no_disponible', http: res.status, mensaje: 'Sitio web oficial no disponible', url, ms: Date.now() - inicio };
    }
    const texto = await res.text();
    let resultados = 0;
    let detalle = '';
    try {
      const j = JSON.parse(texto);
      resultados = j?.result?.count ?? j?.result?.results?.length ?? j?.count ?? (Array.isArray(j) ? j.length : 0);
      detalle = j?.result?.results?.[0]?.title || j?.result?.results?.[0]?.name || '';
    } catch {
      if (/WMS_Capabilities/i.test(texto)) { resultados = 1; detalle = 'WMS capabilities'; }
      else if (/ServiceException/i.test(texto)) resultados = 0;
      else resultados = texto.trim() ? 1 : 0;
    }
    return {
      id: f.id, estado: 'disponible', http: res.status, url, resultados, detalle,
      ms: Date.now() - inicio,
    };
  } catch (err) {
    return {
      id: f.id, estado: 'no_disponible', url,
      mensaje: 'Sitio web oficial no disponible',
      detalle: String(err?.name || err?.message || err).slice(0, 120),
      ms: Date.now() - inicio,
    };
  } finally {
    cancel();
  }
}

export async function estadoFuentes(fuentes, q = '', fetchFn = fetch, limite = 8) {
  const seleccion = (fuentes || []).filter((f) => f?.base && f.estado !== 'pendiente_lanzamiento').slice(0, limite);
  const tareas = seleccion.map(async (f) => {
    const clave = `${f.id}|${q}`;
    const guardado = cache.get(clave);
    if (guardado && Date.now() - guardado.t < TTL_MS) return guardado.v;
    const v = await consultarFuente(f, q, fetchFn);
    cache.set(clave, { t: Date.now(), v });
    return v;
  });
  return Promise.all(tareas);
}

export function overlayDecisiones(payload, estados, recomendaciones = {}) {
  const porId = new Map((estados || []).map((e) => [e.id, e]));
  const decisiones = (payload?.decisiones || []).map((d) => {
    const vivas = (d.fuentes_requeridas || []).map((r) => ({
      ...r, ...(porId.get(r.fuente) || { estado: 'no_consultada' }),
    }));
    const caidas = vivas.filter((v) => v.estado === 'no_disponible' || v.estado === 'sin_url');
    if (caidas.length) {
      return {
        ...d,
        puede_decidir: false,
        motivo: 'sitio_oficial_no_disponible',
        sitios_no_disponibles: caidas.map((c) => c.id),
        recomendacion_viva: recomendaciones.sitio_no_disponible || {
          texto: 'Sitio web oficial no disponible. Reintentar antes de pedir dato.',
          acciones: ['reintentar', 'no_usar'],
        },
        fuentes_vivas: vivas,
      };
    }
    return { ...d, fuentes_vivas: vivas };
  });
  return { ...payload, decisiones, consulta: 'en_vivo' };
}

async function jsonDe(ruta, origin, env) {
  const url = new URL(ruta, origin);
  const assetFetch = env?.ASSETS?.fetch || fetch;
  try {
    const r = await assetFetch(url);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}

export async function handleLive(request, env) {
  const url = new URL(request.url);
  const ruta = url.pathname;
  if (!ruta.startsWith('/api/')) return null;

  if (ruta === '/api/fuentes') {
    const f = await jsonDe('/fuentes.json', url.origin, env);
    return Response.json(f || { fuentes: [] });
  }
  if (ruta === '/api/grafo') {
    const g = await jsonDe('/grafo.json', url.origin, env);
    return Response.json(g || { nodos: [], aristas: [] });
  }
  if (ruta === '/api/buscar') {
    const q = url.searchParams.get('q') || '';
    const f = await jsonDe('/fuentes.json', url.origin, env);
    const estados = await estadoFuentes(f?.fuentes || [], q);
    return Response.json({ q, estados, generado: new Date().toISOString() });
  }
  if (ruta === '/api/decisiones') {
    const q = url.searchParams.get('q') || '';
    const [payload, f, grafo] = await Promise.all([
      jsonDe('/decisiones.json', url.origin, env),
      jsonDe('/fuentes.json', url.origin, env),
      jsonDe('/grafo.json', url.origin, env),
    ]);
    if (!payload) return Response.json({ error: 'decisiones.json no publicado' }, { status: 503 });
    const estados = await estadoFuentes(f?.fuentes || [], q);
    const vivo = overlayDecisiones(payload, estados, f?.recomendaciones || {});
    return Response.json({ ...vivo, linaje: { grafo: '/api/grafo', hash_estatico: payload.hash, nodos: grafo?.nodos?.length || 0 } });
  }
  return Response.json({ error: 'ruta api desconocida' }, { status: 404 });
}
