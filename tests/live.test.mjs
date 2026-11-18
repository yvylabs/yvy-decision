import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLive } from '../functions/api/_live.mjs';

function req(pathname, base = 'https://example.com') {
  return new Request(new URL(pathname, base));
}

test('api/decisiones sirve la base, sin overlay de sitio', async () => {
  const resp = await handleLive(req('/api/decisiones'), {
    ASSETS: { fetch: async (r) => Response.json({ decisiones: [{ pregunta_id: 'p1', status: 'abstain', puede_decidir: false }], hash: 'a'.repeat(64) }) },
  });
  const d = await resp.json();
  assert.equal(d.consulta, 'base_verificada');
  assert.equal(d.decisiones[0].status, 'abstain');
  assert.ok(!JSON.stringify(d).includes('sitio_oficial_no_disponible'));
});

test('api/preguntar resuelve evidencia por alias', async () => {
  const env = {
    ASSETS: {
      fetch: async (r) => {
        const p = new URL(r.url).pathname;
        if (p === '/intenciones.json') return Response.json({ intenciones: [{ tipo: 'evidencia', respuesta: 'escuelas_en_cerrillos', alias: ['cuantas escuelas hay en cerrillos'] }] });
        if (p === '/evidencias.json') return Response.json({ consultas: [{ id: 'escuelas_en_cerrillos', valor: 37, unidad: 'establecimientos' }] });
        return Response.json({ hash: 'b'.repeat(64) });
      },
    },
  };
  const resp = await handleLive(req('/api/preguntar?q=¿Cuántas%20escuelas%20hay%20en%20Cerrillos?'), env);
  const d = await resp.json();
  assert.equal(d.encontrado, true);
  assert.equal(d.tipo, 'evidencia');
  assert.equal(d.dato.valor, 37);
});

test('api/preguntar no inventa respuesta sin coincidencia', async () => {
  const env = {
    ASSETS: {
      fetch: async (r) => {
        const p = new URL(r.url).pathname;
        if (p === '/intenciones.json') return Response.json({ intenciones: [] });
        if (p === '/decisiones.json') return Response.json({ decisiones: [], hash: 'c'.repeat(64) });
        return Response.json({ consultas: [] });
      },
    },
  };
  const resp = await handleLive(req('/api/preguntar?q=valor%20de%20la%20soja%20en%20marte'), env);
  const d = await resp.json();
  assert.equal(d.encontrado, false);
  assert.match(d.texto, /No hay decisión o evidencia registrada/);
});
