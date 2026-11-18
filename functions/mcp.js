// MCP de solo lectura sobre decisiones.json + grafo.json (Pages Function /mcp).
const TOOLS = [
  { name: 'buscar_fuentes', description: 'Estado en vivo de las fuentes del allowlist' },
  { name: 'decidir', description: 'Decisiones con motivo, confianza y recomendación' },
  { name: 'ver_traza', description: 'Grafo generado y hash de la corrida' },
];

async function jsonDe(ruta, origin, env) {
  const assetFetch = env?.ASSETS?.fetch?.bind(env.ASSETS) || fetch;
  try {
    const r = await assetFetch(new Request(new URL(ruta, origin)));
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}

export async function onRequest({ request, url, env }) {
  if (request.method === 'GET') {
    return Response.json({ schema: 'yvy-mcp-v1', tools: TOOLS, solo_lectura: true });
  }
  let body = {};
  try { body = await request.json(); } catch { return Response.json({ error: 'json invalido' }, { status: 400 }); }

  if (url.pathname.startsWith('/api/')) {
    const { handleLive } = await import('./api/_live.mjs');
    return handleLive(request, env);
  }

  const decisiones = await jsonDe('/decisiones.json', url.origin, env);
  if (!decisiones) return Response.json({ error: 'decisiones.json no publicado' }, { status: 503 });
  const nombre = body.params?.name || body.name;
  if (nombre === 'decidir') return Response.json({ decisiones: decisiones.decisiones, hash: decisiones.hash });
  if (nombre === 'ver_traza') {
    const grafo = await jsonDe('/grafo.json', url.origin, env);
    return Response.json({ grafo: grafo || { nodos: [], aristas: [] }, hash: decisiones.hash });
  }
  if (nombre === 'buscar_fuentes') {
    const { estadoFuentes } = await import('./api/_live.mjs');
    const f = await jsonDe('/fuentes.json', url.origin, env);
    return Response.json({ estados: await estadoFuentes(f?.fuentes || [], body.q || '') });
  }
  return Response.json({ error: 'tool desconocida' }, { status: 400 });
}
