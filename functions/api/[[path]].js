// Cloudflare Pages Function: /api/* → lógica de consulta en vivo.
export async function onRequest(ctx) {
  const { handleLive } = await import('./_live.mjs');
  return handleLive(ctx.request, ctx.env, ctx);
}
