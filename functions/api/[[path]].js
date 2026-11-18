// Cloudflare Pages Function: /api/* → lógica de consulta en vivo.
// La lógica vive dentro de web/ porque Pages solo empaqueta el output dir.
export { handleLive as onRequest } from './_live.mjs';
