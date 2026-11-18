// MCP de solo lectura sobre la BD publicada (Pages Function /mcp).
const TOOLS = [
  { name: 'decidir', description: 'Devuelve las decisiones con motivo y hash' },
  { name: 'ver_traza', description: 'Devuelve el grafo de linaje y el hash' },
  { name: 'ver_evidencia', description: 'Devuelve los datos calculados con su fuente y hash' },
];

export async function onRequest({ request, url, env }) {
  if (request.method === 'GET') {
    return Response.json({ schema: 'yvy-mcp-v1', tools: TOOLS, solo_lectura: true });
  }
  let body = {};
  try { body = await request.json(); } catch { return Response.json({ error: 'json invalido' }, { status: 400 }); }
  const nombre = body.params?.name || body.name;
  const ruta = nombre === 'ver_traza' ? '/api/grafo'
    : nombre === 'ver_evidencia' ? '/api/evidencias'
    : '/api/decisiones';
  const r = await env?.ASSETS?.fetch?.bind(env.ASSETS)(new Request(new URL(ruta, url.origin)));
  if (!r?.ok) return Response.json({ error: 'no se pudo leer la base' }, { status: 503 });
  const datos = await r.json();
  return Response.json({ ...datos, tool: nombre });
}
