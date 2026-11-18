import test from 'node:test';
import assert from 'node:assert/strict';
import { consultarFuente, overlayDecisiones, urlPara } from '../worker/live.mjs';

const fuente = (id, tipo, base) => ({ id, tipo, base, estado: 'activo' });

test('urlPara arma la base del API, nunca la home', () => {
  assert.equal(urlPara(fuente('datos_gob_ar', 'ckan', 'https://datos.gob.ar/api/3/action'), 'educacion'),
    'https://datos.gob.ar/api/3/action/package_search?q=educacion&rows=5');
  assert.equal(urlPara(fuente('indec_series', 'rest', 'https://apis.datos.gob.ar/series/api'), 'ipc'),
    'https://apis.datos.gob.ar/series/api/search/?q=ipc');
  assert.equal(urlPara(fuente('x', 'wms_wfs', 'https://wms.ign.gob.ar/geoserver/ows')),
    'https://wms.ign.gob.ar/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities');
  assert.equal(urlPara({ id: 'pendiente', base: 'PENDIENTE_VERIFICAR' }), null);
});

test('sitio caido se reporta como no_disponible, no como falta de dato', async () => {
  const fetchQueFalla = async () => { throw new Error('ECONNREFUSED'); };
  const r = await consultarFuente(fuente('idesa', 'wms_wfs', 'https://geoportal.salta.gob.ar'), '', fetchQueFalla);
  assert.equal(r.estado, 'no_disponible');
  assert.match(r.mensaje, /no disponible/i);
});

test('respuesta valida cuenta resultados', async () => {
  const fetchOk = async () => ({ status: 200, text: async () => JSON.stringify({ result: { count: 3, results: [{ title: 'a' }] } }) });
  const r = await consultarFuente(fuente('datos_gob_ar', 'ckan', 'https://datos.gob.ar/api/3/action'), 'educacion', fetchOk);
  assert.equal(r.estado, 'disponible');
  assert.equal(r.resultados, 3);
});

test('overlay cambia el motivo cuando el sitio oficial no responde', () => {
  const payload = {
    decisiones: [{
      pregunta_id: 'p1', status: 'abstain', puede_decidir: false, motivo: 'sin_fuente_oficial_encontrada',
     recommendacion: { texto: 'generar estimacion' },
      fuentes_requeridas: [{ hecho: 'h1', fuente: 'idesa_salta' }],
    }],
  };
  const estados = [{ id: 'idesa_salta', estado: 'no_disponible' }];
  const recs = { sitio_no_disponible: { texto: 'Sitio web oficial NO DISPONIBLE', acciones: ['reintentar'] } };
  const out = overlayDecisiones(payload, estados, recs);
  const d = out.decisiones[0];
  assert.equal(d.motivo, 'sitio_oficial_no_disponible');
  assert.deepEqual(d.sitios_no_disponibles, ['idesa_salta']);
  assert.equal(d.puede_decidir, false);
  assert.match(d.recomendacion_viva.texto, /NO DISPONIBLE/);
  assert.equal(d.fuentes_vivas[0].estado, 'no_disponible');
});
