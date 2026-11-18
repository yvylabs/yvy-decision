// API de la BD verificada. Sin consultas a sitios externos en runtime.
// El link del sitio es procedencia/auditoría, no un gate de respuesta.
async function jsonDe(ruta, origin, env) {
  const assetFetch = env?.ASSETS?.fetch?.bind(env.ASSETS) || fetch;
  try {
    const r = await assetFetch(new Request(new URL(ruta, origin)));
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}

export async function handleLive(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  if (url.pathname === '/api/decisiones') {
    const d = await jsonDe('/decisiones.json', url.origin, env);
    if (!d) return Response.json({ error: 'decisiones.json no publicado' }, { status: 503 });
    const g = await jsonDe('/grafo.json', url.origin, env);
    return Response.json({ ...d, consulta: 'base_verificada', linaje: { grafo: '/api/grafo', hash_estatico: d.hash, nodos: g?.nodos?.length || 0 } });
  }
  if (url.pathname === '/api/grafo') return Response.json(await jsonDe('/grafo.json', url.origin, env) || { nodos: [], aristas: [] });
  if (url.pathname === '/api/fuentes') return Response.json(await jsonDe('/fuentes.json', url.origin, env) || { fuentes: [] });
  if (url.pathname === '/api/evidencias') return Response.json(await jsonDe('/evidencias.json', url.origin, env) || { consultas: [] });
  if (url.pathname === '/api/intenciones') return Response.json(await jsonDe('/intenciones.json', url.origin, env) || { intenciones: [] });

  // Búsqueda determinista: normaliza el texto y devuelve la salida registrada.
  if (url.pathname === '/api/preguntar') {
    const q = (url.searchParams.get('q') || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const [ints, evs, dec] = await Promise.all([
      jsonDe('/intenciones.json', url.origin, env),
      jsonDe('/evidencias.json', url.origin, env),
      jsonDe('/decisiones.json', url.origin, env),
    ]);
    const normal = (t) => String(t).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let mejor = null;
    for (const it of ints?.intenciones || []) {
      for (const alias of it.alias || []) {
        const a = normal(alias);
        if (a && (q.includes(a) || a.includes(q)) && (!mejor || a.length > mejor.len)) {
          mejor = { it, len: a.length };
        }
      }
    }
    if (!mejor) {
      return Response.json({
        encontrado: false,
        texto: 'No hay decisión o evidencia registrada para esa consulta. No voy a improvisar.',
        disponibles: [...(dec?.decisiones || []).map((d) => ({ tipo: 'decision', id: d.pregunta_id, texto: d.pregunta })),
                      ...(evs?.consultas || []).map((e) => ({ tipo: 'evidencia', id: e.id, texto: e.id }))],
      });
    }
    if (mejor.it.tipo === 'evidencia') {
      const ev = (evs?.consultas || []).find((e) => e.id === mejor.it.respuesta);
      return Response.json({ encontrado: true, tipo: 'evidencia', dato: ev || null, hash: dec?.hash });
    }
    const d = (dec?.decisiones || []).find((x) => x.pregunta_id === mejor.it.respuesta);
    return Response.json({ encontrado: true, tipo: 'decision', decision: d || null, hash: dec?.hash });
  }

  return Response.json({ error: 'ruta api desconocida' }, { status: 404 });
}
