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
# `apps/web` import **bản đã build** của ba package trong workspace: cả ba đều
# trỏ `main` vào `./dist`, và `.dockerignore` loại `**/dist` nên không có gì
# được mang sẵn vào context. Thiếu chúng thì `next build` chết — đúng như nó đã
# chết lần đầu tiên có người chạy `web` trong Compose (M5.5).
#
# `@flowboard/mock` là devDependency, nên nó ở đây trông thừa. Nó không thừa:
# `next build` chạy type check trên `src/test/harness.tsx`, tệp này không có
# `.test.` trong tên nên không rơi vào `exclude` của `apps/web/tsconfig.json`,
# và nó import `@flowboard/mock`. Ranh giới đó đáng xem lại, nhưng xem lại nó
# bằng cách bỏ type check của harness là đổi một image hỏng lấy một harness
# không ai kiểm kiểu.
RUN pnpm --filter @flowboard/contracts build && pnpm --filter @flowboard/ui build && pnpm --filter @flowboard/mock build && pnpm --filter @flowboard/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/package.json ./package.json
USER node
WORKDIR /app/apps/web
# `--keepAliveTimeout` cao hơn mặc định của Node (5 giây), và đó không phải một
# con số tuỳ tiện. Server đóng socket rỗi ở giây thứ 5, còn trình duyệt vẫn giữ
# nó để dùng lại: hai bên gặp nhau đúng lúc thì request rơi vào một socket vừa
# bị đóng và client nhận `ERR_CONNECTION_RESET`. Với một trang Next, thứ rơi
# thường là một chunk JavaScript — trang hiện ra nhưng không hydrate, và mọi
# form trên đó im lặng không phản hồi. Triệu chứng đã bắt được ở M5.5.
#
# Cùng lý do, sau này đặt một load balancer phía trước thì idle timeout của nó
# phải **nhỏ hơn** con số này.
CMD ["node_modules/.bin/next", "start", "--port", "3000", "--keepAliveTimeout", "70000"]
