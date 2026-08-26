# Build en 2 etapas para tener una imagen de desarrollo liviana.
# (Esto solo lo usa docker-compose para desarrollo; en Vercel el build es otro.)

# --- Etapa 1: instalar dependencias ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# npm install trae node_modules. En dev no copiamos lock estricto para simplicidad.
RUN npm install

# --- Etapa 2: runtime ---
FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copiamos el código. En dev, docker-compose monta esto como volumen para HMR,
# pero por defecto copiamos para que la imagen funcione sola.
COPY . .
EXPOSE 5173
# --host para que sea accesible fuera del contenedor.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]