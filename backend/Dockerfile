# Imagen base: Python 3.12 liviana. Coincide con .python-version (para Vercel).
FROM python:3.12-slim

# Evita que Python escriba .pyc (archivos cache) y hace que los prints salgan
# en vivo (sin esto, los logs del contenedor se verían a saltos).
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /app

# Instalamos primero solo requirements para aprovechar el cache de Docker:
# si no cambian las dependencias, esta capa se reutiliza y el build es rápido.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el código de la app.
COPY app/ ./app/

EXPOSE 8000

# Al levantar el contenedor: creamos las tablas y cargamos datos de ejemplo
# (ambos son idempotentes, así que reiniciar no duplica nada) y arrancamos
# uvicorn accesible desde otros contenedores (--host 0.0.0.0).
CMD ["sh", "-c", "python -m app.init_db && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]