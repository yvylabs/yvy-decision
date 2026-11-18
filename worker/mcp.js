// MCP de solo lectura sobre decisiones.json + grafo.json.
// Sin Python, sin base de datos, sin escritura. Corre en el free tier.
const TOOLS = [
  { name: 'buscar_fuentes', description: 'Lista fuentes oficiales del allowlist (solo lectura)' },
  { name: 'decidir', description: 'Devuelve status, puede_decidir, motivo y recomendación por pregunta' },
  { name: 'ver_traza', description: 'Devuelve el grafo de decisión y el hash de la corrida' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/mcp') return new Response('not found', { status: 404 });
    if (request.method === 'GET') {
      return Response.json({ schema: 'yvy-mcp-v1', tools: TOOLS, solo_lectura: true });
    }
    let body = {};
    try { body = await request.json(); } catch { return Response.json({ error: 'json invalido' }, { status: 400 }); }
    const decisiones = await fetch(new URL('/decisiones.json', url.origin)).then((r) => r.json()).catch(() => null);
    if (!decisiones) return Response.json({ error: 'decisiones.json no publicado' }, { status: 503 });
    const nombre = body.params?.name || body.name;
    if (nombre === 'decidir') return Response.json({ decisiones: decisiones.decisiones, hash: decisiones.hash });
    if (nombre === 'ver_traza') {
      const grafo = await fetch(new URL('/grafo.json', url.origin)).then((r) => r.json()).catch(() => ({}));
      return Response.json({ grafo, hash: decisiones.hash });
    }
    if (nombre === 'buscar_fuentes') return Response.json({ error: 'allowlist disponible solo en el repo; uso restringido' }, { status: 501 });
    return Response.json({ error: 'tool desconocida' }, { status: 400 });
  },
};
