# No tag fallback is allowed. container:verify supplies the immutable image
# reference recorded in container-contract.json.
ARG NODE_BASE_IMAGE

FROM ${NODE_BASE_IMAGE} AS build

ARG NODE_BASE_IMAGE
RUN node -e "const image=process.env.NODE_BASE_IMAGE??'';if(!/^node:22\\.22\\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/.test(image)){console.error('NODE_BASE_IMAGE must be an immutable Node 22.22.2 digest.');process.exit(64)}"

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable
RUN corepack prepare pnpm@11.7.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm opa:install
RUN pnpm build

FROM ${NODE_BASE_IMAGE} AS runtime

ARG NODE_BASE_IMAGE
RUN node -e "const image=process.env.NODE_BASE_IMAGE??'';if(!/^node:22\\.22\\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/.test(image)){console.error('NODE_BASE_IMAGE must be an immutable Node 22.22.2 digest.');process.exit(64)}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV OPA_PATH=/usr/local/bin/opa
ENV POLICYTWIN_DATABASE_PATH=/data/policytwin.sqlite

WORKDIR /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.tools/opa/1.18.2/opa /usr/local/bin/opa

RUN mkdir /data
RUN chown node:node /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(async(response)=>{const body=await response.json();if(!response.ok||body.status!=='ok'||body.service!=='policytwin'||body.schemaVersion!=='1')process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
