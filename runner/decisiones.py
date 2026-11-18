#!/usr/bin/env python3
"""
Yvy Decisión — runner de decisión (fase POC).

Lee allowlist.yaml, fuentes_generadas.yaml, ontologia.yaml, preguntas.yaml,
scope.yaml y politica.yaml. NO descarga nada todavía: decide sobre lo que
está declarado/sellado en datos/fuentes.json (opcional).

Si una fuente oficial NO fue encontrada, la respuesta es abstain con la
recomendación exacta: "No hay fuente oficial ENCONTRADA ... estimación
basada en fuentes científicas pero NO oficiales".

Salida: web/decisiones.json + web/grafo.json, con hash canónico y replay.
"""
from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import yaml

def evidencias_idesa() -> dict:
    """Descarga escuelas georreferenciadas de IDESA y devuelve evidencia sellada."""
    base = "https://geoportal.salta.gob.ar/geoserver/ows"
    params = {
        "service": "WFS", "version": "1.0.0", "request": "GetFeature",
        "typeName": "geonode:establecimientos_educativos",
        "CQL_FILTER": "departamento='CERRILLOS'",
        "outputFormat": "application/json",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    destino = WEB / "evidencias.json"
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            crudo = r.read()
        datos = json.loads(crudo)
        features = datos.get("features") or []
        escuelas = [f for f in features
                    if str((f.get("properties") or {}).get("departamento", "")).upper() == "CERRILLOS"]
        return {
            "schema": "yvy-evidencia-v1",
            "consultas": [{
                "id": "escuelas_en_cerrillos",
                "valor": len(escuelas),
                "unidad": "establecimientos",
                "fuente": "IDESA WFS · geonode:establecimientos_educativos",
                "url_original": url,
                "metodo": "GetFeature CQL_FILTER departamento='CERRILLOS'",
                "fecha_corte": datetime.now(timezone.utc).date().isoformat(),
                "sha256": hashlib.sha256(crudo).hexdigest(),
            }],
        }
    except Exception:
        if destino.exists():
            return json.loads(destino.read_text(encoding="utf8"))
        return {"schema": "yvy-evidencia-v1", "consultas": []}

RAIZ = Path(__file__).resolve().parents[1]
WEB = RAIZ / "web"
DATOS = RAIZ / "datos"


def cargar(nombre: str):
    return yaml.safe_load((RAIZ / nombre).read_text(encoding="utf8"))


def canonico(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(obj) -> str:
    return hashlib.sha256(canonico(obj).encode("utf8")).hexdigest()


def fuentes_selladas() -> dict:
    """Fuente => metadata sellada. En el POC se lee de datos/fuentes.json."""
    ruta = DATOS / "fuentes.json"
    if not ruta.exists():
        return {}
    return json.loads(ruta.read_text(encoding="utf8"))


def indice_fuentes(allowlist, generadas, selladas):
    idx = {}
    for f in allowlist:
        idx[f["id"]] = {
            "id": f["id"],
            "oficial": True,
            "organismo": (f.get("organismos_permitidos") or ["desconocido"])[0],
            "alcance": f.get("alcance_territorial"),
            "jurisdiccion": f.get("jurisdiccion"),
            "relacion": f.get("relacion", "describe"),
            "encontrada": f["id"] in selladas,
            "meta": selladas.get(f["id"], {}),
        }
    for f in generadas:
        idx[f["id"]] = {
            "id": f["id"],
            "oficial": bool(f.get("oficial", False)),
            "no_oficial": bool(f.get("no_oficial", False)),
            "productor": f.get("productor", "Yvy Labs"),
            "estado": f.get("estado", "desconocido"),
            "metodo": f.get("metodo"),
            "control": f.get("control"),
            "encontrada": (f.get("estado") in ("generado", "activo")) and bool(f.get("hash_derivado")),
            "meta": f,
        }
    return idx


def fuente_de_hecho(ontologia, hecho_id):
    h = (ontologia.get("hechos") or {}).get(hecho_id) or {}
    return (h.get("fuentes") or [None])[0], h


def evaluar(pregunta, ontologia, idx, politica, generadas):
    reqs = pregunta.get("requiere") or []
    fmt = (politica.get("recomendaciones") or {}).get("sin_fuente_oficial_encontrada") or {}
    fallidas = []
    usadas = []
    estimacion_disponible = False

    for hecho_id in reqs:
        fuente_id, hecho = fuente_de_hecho(ontologia, hecho_id)
        f = idx.get(fuente_id) or {}
        if f.get("encontrada") and f.get("oficial"):
            usadas.append(fuente_id)
            continue
        if f.get("encontrada") and f.get("no_oficial"):
            estimacion_disponible = True
        fallidas.append({"hecho": hecho_id, "fuente": fuente_id, "por_que": "sin_fuente_oficial_encontrada"})

    duros = pregunta.get("reglas_duras") or []
    if fallidas:
        status = "abstain"
        puede = False
        motivo = "sin_fuente_oficial_encontrada"
        if estimacion_disponible:
            recomendacion = {
                "tipo": "generar_estimacion",
                "texto": fmt.get("texto", "").strip(),
                "metodo": "dasimetrico_buildup_2023",
                "no_oficial": True,
                "acciones": fmt.get("acciones", []),
            }
        else:
            recomendacion = {
                "tipo": "buscar_fuente",
                "texto": "No hay fuente oficial ENCONTRADA. Buscar en el allowlist o solicitar dato.",
                "acciones": ["buscar_fuente", "solicitar_curaduria"],
            }
    elif duros and any("no_" in r or "debe" in r for r in duros):
        status = "forced"
        puede = (politica.get("estados_decidibles") or {}).get("forced") == "decidible"
        motivo = "check_duro:" + ",".join(duros)
        recomendacion = {"tipo": "regla_dura", "texto": "La regla dura impidió la respuesta del modelo. Decisión operativa: no.", "acciones": ["ver_regla", "ver_traza"]}
    else:
        status = "ok"
        puede = True
        motivo = None
        recomendacion = {"tipo": "ninguna", "texto": "", "acciones": []}

    confianza = None
    for u in usadas:
        m = idx[u].get("meta") or {}
        c = m.get("confianza")
        if isinstance(c, (int, float)):
            confianza = c if confianza is None else min(confianza, c)

    return {
        "pregunta_id": pregunta.get("id"),
        "pregunta": pregunta.get("texto"),
        "status": status,
        "puede_decidir": puede,
        "motivo": motivo,
        "confianza": confianza,
        "faltan": fallidas,
        "fuentes_usadas": usadas,
        "recomendacion": recomendacion,
        "accion_si": pregunta.get("si_si"),
        "accion_no": pregunta.get("si_no"),
    }


def main():
    allow = (cargar("allowlist.yaml") or {}).get("fuentes") or []
    generadas = (cargar("fuentes_generadas.yaml") or {}).get("fuentes") or []
    ont = cargar("ontologia.yaml") or {}
    preguntas = (cargar("preguntas.yaml") or {}).get("preguntas") or []
    politica = cargar("politica.yaml") or {}
    scope = cargar("scope.yaml") or {}
    intenciones = cargar("intenciones.yaml") or {}

    idx = indice_fuentes(allow, generadas, fuentes_selladas())
    decisiones = [evaluar(p, ont, idx, politica, generadas) for p in preguntas]

    # Mapa hecho -> fuente para que el Worker pueda consultar en vivo.
    hecho_a_fuente = {}
    for hid, h in (ont.get("hechos") or {}).items():
        hecho_a_fuente[hid] = (h.get("fuentes") or [None])[0]
    for d, p in zip(decisiones, preguntas):
        d["fuentes_requeridas"] = [
            {"hecho": h, "fuente": hecho_a_fuente.get(h)}
            for h in (p.get("requiere") or [])
        ]

    nodos = [{"id": "pregunta:" + d["pregunta_id"], "tipo": "pregunta"} for d in decisiones]
    aristas = []
    for d in decisiones:
        for f in d["fuentes_usadas"]:
            nodos.append({"id": "fuente:" + f, "tipo": "fuente"})
            aristas.append({"de": "fuente:" + f, "a": "pregunta:" + d["pregunta_id"], "rel": "sostiene"})
        for x in d["faltan"]:
            nodos.append({"id": "faltante:" + str(x["fuente"]), "tipo": "faltante"})
            aristas.append({"de": "faltante:" + str(x["fuente"]), "a": "pregunta:" + d["pregunta_id"], "rel": "abstiene"})
    # Deduplicar nodos
    vistos = set()
    nodos = [n for n in nodos if not (n["id"] in vistos or vistos.add(n["id"]))]

    grafo = {"nodos": nodos, "aristas": aristas}
    payload = {
        "schema": "yvy-decision-v1",
        "generado": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "alcance": scope.get("alcance", {}),
        "motor": "determinista_poc",
        "decisiones": decisiones,
        "hash": sha({"decisiones": decisiones, "grafo": grafo}),
        "canonico": "RFC8785-like",
        "algoritmo": "sha256",
    }

    WEB.mkdir(exist_ok=True)
    (WEB / "decisiones.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (WEB / "grafo.json").write_text(json.dumps(grafo, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    # Contratos livianos para el Worker (consulta en vivo sin YAML en runtime).
    (WEB / "fuentes.json").write_text(json.dumps({
        "fuentes": [{
            "id": f.get("id"), "tipo": f.get("tipo"), "base": f.get("base"),
            "modos": f.get("modos") or [], "organismo": (f.get("organismos_permitidos") or [None])[0],
            "alcance": f.get("alcance_territorial"), "jurisdiccion": f.get("jurisdiccion"),
            "estado": f.get("estado", "activo"), "pdf_escaneado": bool(f.get("pdf_escaneado")),
        } for f in allow],
        "recomendaciones": (politica.get("recomendaciones") or {}),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (WEB / "ontologia.json").write_text(json.dumps(ont, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (WEB / "evidencias.json").write_text(json.dumps(evidencias_idesa(), ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (WEB / "intenciones.json").write_text(json.dumps(intenciones, ensure_ascii=False, indent=2) + "\n", encoding="utf8")

    print(f"[yvy-decision] {len(decisiones)} preguntas · " +
          ", ".join(f"{d['pregunta_id']}={d['status']}" for d in decisiones))
    print(f"[yvy-decision] hash {payload['hash'][:16]}… → web/decisiones.json + web/grafo.json")


if __name__ == "__main__":
    main()
