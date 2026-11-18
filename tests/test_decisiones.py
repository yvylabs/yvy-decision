import json
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


class TestDecisiones(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads((RAIZ / "web/decisiones.json").read_text(encoding="utf8"))
        cls.g = json.loads((RAIZ / "web/grafo.json").read_text(encoding="utf8"))

    def test_schema_y_hash(self):
        self.assertEqual(self.d["schema"], "yvy-decision-v1")
        self.assertEqual(len(self.d["hash"]), 64)

    def test_cuatro_preguntas_y_abstencion(self):
        self.assertEqual(len(self.d["decisiones"]), 4)
        for x in self.d["decisiones"]:
            self.assertIn(x["status"], ("ok", "abstain", "forced"))
            if x["status"] == "abstain":
                self.assertFalse(x["puede_decidir"])
                self.assertIn("ENCONTRADA", x["recomendacion"]["texto"])

    def test_grafo_generado(self):
        self.assertGreater(len(self.g["nodos"]), 0)
        self.assertGreater(len(self.g["aristas"]), 0)


if __name__ == "__main__":
    unittest.main()
