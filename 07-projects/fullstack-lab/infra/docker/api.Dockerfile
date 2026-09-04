# Image của apps/api.
#
# Multi-stage: stage build có toàn bộ workspace để pnpm giải được dependency
# graph; stage runtime chỉ giữ những gì cần để chạy. Image được build lại từ
# một commit đã review và cho ra cùng kết quả — đó là điều kiện để CI ghi lại
# digest và để rollback bằng digest có nghĩa.

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
RUN pnpm install --frozen-lockfile --filter @flowboard/api...

FROM deps AS build
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @flowboard/contracts build && pnpm --filter @flowboard/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/package.json ./package.json
USER node
WORKDIR /app/apps/api
# Chạy output đã build, không chạy source: NestJS ở M1 dùng decorator, mà chế độ
# chỉ bóc kiểu của Node không hỗ trợ cú pháp sinh code.
CMD ["node", "dist/main.js"]
