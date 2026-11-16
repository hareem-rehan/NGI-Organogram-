# Production image for the company server (D72). Two targets:
#
#   app    (default) the web app: `node server.js` on port 3000, no
#          source code, no dev tools, runs as a non-root user.
#   tools  the full project (source + all dependencies), for one-off
#          commands: `prisma migrate deploy`, `npm run auth:provision`,
#          `npm run preflight:production`. Never left running.
#
# Build both with docker-compose.production.yml (see
# docs/DEPLOYMENT_RUNBOOK.md "Company server"). No secret is baked into
# either image: every setting comes from the server's env file at run time,
# except NEXT_PUBLIC_APP_NAME, which Next.js bakes in at build time.

FROM node:22-bookworm-slim AS base
# openssl: Prisma's query engine. fontconfig + Liberation fonts: PNG export
# renders SVG text through sharp/librsvg, which needs real font files
# (Liberation Sans is metric-compatible with Arial/Helvetica, the export
# font). PDF export uses PDF's built-in Helvetica and needs no font file.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_NAME="DotZero Organogram"
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_OUTPUT=standalone
RUN npm run build

# One-off commands only (migrations, provisioning, preflight).
FROM build AS tools
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "status"]

FROM base AS app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
