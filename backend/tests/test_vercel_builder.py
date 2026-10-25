"""
Tests del deploy serverless (config de @vercel/python).

Regla que fija (hallazgo deploy 2026-10-25): el builder @vercel/python busca
requirements.txt EN EL MISMO DIRECTORIO del entrypoint (app/main.py), no en
la raíz backend/ — por eso el primer deploy a Vercel se cayó con
ModuleNotFoundError: fastapi. El espejo backend/app/requirements.txt es lo
que el builder consume; este test pinnea que NO se desincronice del original.
"""
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def test_espejo_de_requirements_sincronizado():
    original = (BACKEND / "requirements.txt").read_text(encoding="utf-8").strip().splitlines()
    espejo = (BACKEND / "app" / "requirements.txt").read_text(encoding="utf-8").strip().splitlines()
    # Igual en las líneas de PAQUETES (ignoramos comentarios/vacíos para que
    # un comentario distinto no rompa el test, pero un paquete que falta sí).
    paquetes_original = [l for l in original if l.strip() and not l.strip().startswith("#")]
    paquetes_espejo = [l for l in espejo if l.strip() and not l.strip().startswith("#")]
    assert paquetes_espejo == paquetes_original