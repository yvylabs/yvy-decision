# Yvy Decisión

Motor de decisiones con evidencia oficial, abstención y traza verificable.
**No es un visor, no es un mapa, no es un GIS, no es un catálogo.**

Responde una sola pregunta: *¿puedo actuar con lo que tengo, sí o no?*
Y si la respuesta es no, dice **exactamente qué dato falta**.

## Principios

- Busca **solo en fuentes oficiales declaradas** (`allowlist.yaml`). Nunca web abierta.
- Los datos generados por Yvy Labs existen, pero van en `fuentes_generadas.yaml` con `no_oficial: true`.
- Un radio censal **nunca** se parte por un barrio. Población por barrio es siempre estimada.
- `poblacion_barrio` no se publica como dato del INDEC.
- Todo corre en **free tier**: GitHub Actions + Cloudflare Pages/Worker + R2. Sin Postgres, sin Marmot, sin servicios pagos.

## Estructura

```
allowlist.yaml            fuentes oficiales permitidas (dominios exactos)
fuentes_generadas.yaml    datos Yvy Labs (no oficiales)
ontologia.yaml            hechos, unidades, procedencia, relaciones
preguntas.yaml            4 preguntas de decisión del piloto Cerrillos
scope.yaml                recorte a Cerrillos (lo hace el runner)
politica.yaml             aceptación, precedencia, abstención, humano
runner/decisiones.py      genera decisiones.json + grafo.json
web/                      UI estática + Worker MCP (solo lectura)
```

## Correr el POC

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-decisiones.txt
python runner/decisiones.py
python -m http.server -d web 8080
```

Salida: `web/decisiones.json` y `web/grafo.json`.

## Costo

$0 salvo el dominio `yvylabs.com` (ya pagado). El código es público; los datos originales quedan en R2 privado.

## Marca blanca

`marca.yaml` + "Use this template": el cliente conecta su propia cuenta Cloudflare free y su dominio. Nosotros no hosteamos nada.
