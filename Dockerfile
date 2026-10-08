# ---- Build stage: compile the Svelte/Vite frontend into dist/ ----
# Node 26 — Vitest 5 requires Node ^22.12 || ^24 || >=26 (see package.json "engines").
# The Vite output is architecture-independent. Building it on BUILDPLATFORM
# avoids executing npm's native helper binaries through QEMU for ARM images.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime dependencies, also installed on BUILDPLATFORM ----
# They're pure JavaScript (express, js-yaml and friends), so the same files run
# on any architecture and the ARM image needs no emulated npm. The check below
# fails the build if a native addon ever sneaks in — then this must move back
# into the runtime stage.
FROM --platform=$BUILDPLATFORM node:26-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && if find node_modules \( -name '*.node' -o -name binding.gyp \) | grep -q .; then \
       echo "native addon in runtime dependencies — install them in the runtime stage" >&2; exit 1; \
     fi

# ---- Runtime stage: lean Express server serving the built dist/ ----
FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY server.js ./
COPY --from=build /app/dist ./dist

EXPOSE 80

CMD ["npm", "start"]
