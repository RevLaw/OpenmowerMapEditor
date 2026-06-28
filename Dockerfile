# ---- Build stage: compile the Svelte/Vite frontend into dist/ ----
# Node 22 LTS — Vite 8 / Vitest 4 require Node >= 20.19.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ---- Runtime stage: lean Express server serving the built dist/ ----
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=build /app/dist ./dist

EXPOSE 80

CMD ["npm", "start"]

