# Image của apps/web.
#
# Next.js build ở stage riêng; runtime chỉ nhận artefact đã build. Không copy
# nguyên workspace vào runtime để image không mang theo source và devDependency.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY packages/mock/package.json packages/mock/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @flowboard/web...

FROM deps AS build
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm --filter @flowboard/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/package.json ./package.json
USER node
WORKDIR /app/apps/web
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
