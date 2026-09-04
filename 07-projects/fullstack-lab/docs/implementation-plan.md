# Kế hoạch triển khai Flowboard

## Tài liệu này là gì

Đây là cầu nối giữa **hợp đồng đã chốt** và **dòng code đầu tiên**. Toàn bộ product behavior, permission, data và API đã được quyết trong Markdown; thiết kế đã freeze ở Pencil v0.1. Kế hoạch này không quyết định lại thứ gì trong số đó — nó chỉ trả lời ba câu:

1. Làm theo **thứ tự nào**, để mỗi bước đứng trên nền đã được kiểm chứng thay vì nền giả định.
2. Mỗi bước **xong khi nào** — bằng tiêu chí đo được, không bằng cảm giác.
3. Frontend và backend **tách ở đâu, phải đi cùng nhịp ở đâu**.

**Ai đọc tài liệu này:** người viết code (biết mình làm gì trước, xong thì chứng minh bằng gì), người review (biết cổng ra của mỗi mốc), và chủ dự án (biết đang ở đâu trên đường đi mà không phải đọc code).

**Tài liệu này không chứa:** đặc tả behavior (ở [hợp đồng endpoint](api/endpoint-contracts.md)), quy tắc phân quyền (ở [mô hình phân quyền](security/authorization-model.md)), schema (ở [thiết kế database](data/database-design.md)), hay lý do của các quyết định khó đảo ngược (ở [hồ sơ quyết định](decisions/README.md)). Khi kế hoạch này mâu thuẫn với các tài liệu đó, **các tài liệu đó thắng** và kế hoạch phải sửa.

## Cổng đầu vào — đã đạt

| Điều kiện | Trạng thái |
|---|---|
| Hợp đồng Markdown | Chốt ở baseline v0.1; **12 ADR đều `Accepted`**. ADR-0012 mở trong lúc triển khai và được chủ dự án duyệt 04/09/2026 |
| Thiết kế Pencil | **Freeze v0.1 ngày 04/09/2026**, blob `12d6ff91`; checklist 34/34 |
| Danh mục error code | **28 code**, đóng — không code nào ngoài danh mục được xuất hiện trong response. Bốn code thêm ở M2 để vá chỗ hợp đồng tự mâu thuẫn |
| Code ứng dụng | **Chưa có dòng nào** — đây là điểm xuất phát |

Phạm vi thiết kế của v0.1 là core MVP cộng Phase 1.1 và Phase 1.3. Sprint (1.4) và quan hệ task (1.5) đã có ADR, schema và hợp đồng nhưng **chưa có thiết kế** — chúng thuộc Pencil v0.2 theo quyết định của chủ dự án ngày 04/09/2026.

## Bốn nguyên tắc chi phối mọi mốc

1. **Hợp đồng có trước code.** Không thêm field, filter, sort, route hay error code bằng suy đoán khi viết code. Nếu implementation phát hiện hợp đồng thiếu, dừng lại và sửa hợp đồng trước — không "tạm thêm rồi ghi lại sau".
2. **Mỗi mốc là một vertical slice chạy được.** Không có mốc nào chỉ có backend hoặc chỉ có frontend. Một mốc xong nghĩa là có một hành vi người dùng thật đi được từ browser xuống database.
3. **Quyết định khó đảo ngược cần ADR trước khi code**, theo [quy trình ADR](decisions/README.md): ranh giới package, sở hữu migration, session/auth, ordering/concurrency, worker/queue, deployment.
4. **Definition of done có năm phần**, theo [lộ trình phát hành](product/delivery-roadmap.md): feature chạy được · test cho behavior chính · failure experiment tái hiện được · note giải thích nguyên nhân và trade-off · screenshot hoặc command output để người đọc tự kiểm chứng. **Thiếu một phần là chưa xong** — đặc biệt là phần thứ ba, vì đây là lab chứ không phải một sản phẩm chỉ cần chạy.

## Bản đồ đường đi

```text
M0  Bộ khung và đường nối hợp đồng   ── nối tiếp, không song song được
     │
     ├── M1  Xác thực và phiên          FE ↔ BE đi cùng nhịp
     │
     ├── M2  Workspace và project scope  ─┐
     ├── M3  Board column                 ├── FE ∥ BE chạy song song
     ├── M4  Task · comment · activity   ─┘
     │
     ├── M5  Hoàn thiện, ma trận quyền, vận hành
     │
     └── M6  Phase 1.1 — export tiến độ

     sau đó: Phase 1.2 (worker) · 1.3 (Time Tracking) · 1.4 (Sprint) · 1.5 (quan hệ task)
```

| Mốc | Kết quả người dùng thấy được | Cổng ra rút gọn |
|---|---|---|
| **M0** | Chưa thấy gì; developer mới clone về chạy được topology local | `pnpm` workspace build sạch, Compose lên đủ 4 service, CI chặn merge, token `fb.*` đã thành CSS variable |
| **M1** | Đăng ký, xác minh email, đăng nhập, đăng xuất, quên/đặt lại mật khẩu | Viewer chưa tồn tại nhưng session và CSRF đã thật; Mailpit bắt được mail |
| **M2** | Chọn workspace, mở project được cấp quyền, quản lý thành viên | User A dùng ID của User B nhận `404`, không lộ tồn tại |
| **M3** | Owner cấu hình cột board | Archive cột còn task trả `409 COLUMN_NOT_EMPTY`, không tự dời task |
| **M4** | Vòng lặp chính: tạo, giao, kéo-thả, comment, xem lịch sử | Hai mutation đồng thời → `409 TASK_VERSION_CONFLICT`, không ghi đè âm thầm |
| **M5** | Mọi trạng thái UI đầy đủ; hệ thống quan sát được | Toàn bộ ma trận phân quyền xanh; readiness và log có `requestId` |
| **M6** | Owner tải được báo cáo tiến độ XLSX | Retry cùng `Idempotency-Key` không tạo bản export thứ hai |

---

# M0 — Bộ khung và đường nối hợp đồng

**Đây là mốc duy nhất bắt buộc nối tiếp.** Nếu bỏ qua, frontend và backend sẽ mỗi bên tự diễn giải Markdown theo một cách và trôi khỏi nhau — lỗi kiểu đó chỉ lộ ra ở tích hợp, muộn và đắt.

## M0.1 — Dựng pnpm workspace

Dựng đúng cây thư mục ở [cấu trúc repository](engineering/repository-structure.md), **chỉ tạo thư mục khi có nội dung thật**:

```text
apps/web  apps/api  packages/contracts  packages/ui  packages/config
infra/docker  infra/compose  scripts
```

Không tạo `apps/worker`, `infra/kubernetes`, `infra/monitoring` ở mốc này — chúng thuộc phase sau và tạo sẵn "để dự phòng" là vi phạm quy tắc kiến trúc.

**`apps/web` và `apps/api` cũng chưa được tạo ở M0.1.** Một app package không có framework, không có entry point và không có gì để typecheck thì đúng là thứ "tạo sẵn để dự phòng" mà quy tắc trên cấm. Hai app được dựng ở M0.5 cùng lúc với Next.js, NestJS và service Compose tương ứng — khi đó chúng có nội dung thật.

### Đã dựng — trạng thái ngày 04/09/2026

| Hạng mục | Nội dung |
|---|---|
| Gốc workspace | `package.json` (ESM, scripts `format`/`lint`/`typecheck`/`build`/`test`/`verify`), `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `.editorconfig`, `.gitignore` |
| `packages/config` | Bốn preset TypeScript (`base`, `library`, `node`, `react`), preset ESLint, preset Prettier |
| `packages/contracts` | Manifest, tsconfig, public entry point — bề mặt công khai **trống có chủ ý** cho tới M0.2 |
| `packages/ui` | Manifest, tsconfig, public entry point — trống cho tới M0.4 |

Preset TypeScript bật `strict` cùng bốn cờ mà mặc định không bật: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`. Chọn chặt từ đầu vì nới ra sau thì dễ, siết vào sau thì phải sửa code đã viết.

### Ranh giới package được cưỡng chế bằng máy, không bằng lời

[Cấu trúc repository](engineering/repository-structure.md) nói "app chỉ import public entry point của package" và "không app nào import source nội bộ của app khác". Ranh giới nào chỉ nằm trong văn bản thì sớm muộn cũng bị vi phạm, nên preset ESLint biến cả hai thành lỗi lint chặn merge, qua ba pattern `no-restricted-imports`: `@flowboard/*/src/*` và `@flowboard/*/dist/*`, `**/apps/*/src/**`, và import leo ra ngoài package.

Đã kiểm bằng cách viết một file thử vi phạm cả ba rồi chạy lint: **rule bắt đúng 3/3 lỗi**. Không phải giả định rằng nó hoạt động.

### Phiên bản toolchain và một chỗ phải ghim

Node 22 · pnpm 11.25.0 · **TypeScript 6.0.3** · ESLint 10 · Prettier 3.

TypeScript ổn định mới nhất lúc dựng là **7.0.2**, nhưng `typescript-eslint@8.69.0` — bản mới nhất — khai peer `typescript >=4.8.4 <6.1.0`. Cài TS 7 làm peer gãy và lint mất khả năng phân tích type. Vì vậy ghim **6.0.3**, là bản cao nhất mà bộ lint còn hỗ trợ.

**Điều kiện xem lại:** khi `typescript-eslint` phát hành bản nhận TypeScript 7, gỡ ghim và nâng cả hai cùng lúc. Đây là một version pin, đảo ngược dễ, nên không cần ADR — nhưng phải ghi lại, vì nếu không thì người sau sẽ tưởng dự án dùng TS cũ do quán tính.

**Markdown nằm ngoài phạm vi Prettier.** Chạy formatter lần đầu cho thấy nó muốn ghi lại 59 file Markdown, trong đó có snapshot ở `docs/superpowers/**` và các ADR đã `Accepted` — cả hai nhóm đều bị cấm sửa nội dung. Để máy định dạng ghi lại byte của chúng là vi phạm chính hợp đồng đang bảo vệ chúng. Markdown vì vậy vào `.prettierignore`, và hàng Format trong [CI/CD](operations/ci-cd.md) đã được sửa cho khớp: formatter phủ source và config, còn tính đúng đắn của tài liệu do link check và các phép đối chiếu chéo bảo đảm.

**Cổng ra — đã đạt, chạy được lại bằng `pnpm verify`:** `format` · `lint` · `typecheck` · `build` đều xanh; mỗi package có public entry point khai báo qua `exports`; ranh giới import được lint cưỡng chế và đã kiểm là bắt lỗi thật.

## M0.2 — `packages/contracts`: đường nối FE ↔ BE

Đây là hạng mục quan trọng nhất của M0. `packages/contracts` là **nguồn chân lý dùng chung** cho cả hai bên; Markdown vẫn là nguồn quyết định behavior, nhưng cả web lẫn API đọc cùng một bộ type thay vì mỗi bên tự đọc Markdown.

Nội dung bắt buộc, dịch từ [hợp đồng endpoint](api/endpoint-contracts.md) và [quy ước API](api/api-conventions.md):

| Hạng mục | Nguồn | Ràng buộc |
|---|---|---|
| Zod schema cho request/query/body của từng use case | hợp đồng endpoint | Chỉ field trong allowlist; từ chối field lạ |
| Zod schema cho response projection | mục "Hình dạng resource trả về" | Đúng projection endpoint công bố, không thừa field |
| `ErrorCode` enum | [danh mục error code](api/endpoint-contracts.md#danh-mục-error-code) | **Khớp đúng danh mục, không hơn không kém** (28 code từ 04/09/2026) |
| Envelope thành công và lỗi | quy ước API | `{ code, message, requestId, details? }` |
| Tên capability | [mô hình phân quyền](security/authorization-model.md) | Dùng chung cho `can(action, resource)` |
| Hình dạng cursor | [chính sách query và index](data/query-and-index-policy.md) | Cursor gắn fingerprint của filter/sort |

`packages/contracts` **không** được phụ thuộc Drizzle, NestJS, Next.js hay React. Contract diễn đạt use case cụ thể (`moveTask`), không diễn đạt bảng.

**Cổng ra đo được:** một test đối chiếu hai chiều — mọi code trong `ErrorCode` có mặt trong danh mục Markdown, và mọi code trong danh mục có mặt trong enum. Lệch một code là fail.

### Đã dựng — trạng thái ngày 04/09/2026

Package đọc trực tiếp hai tài liệu Markdown tại thời điểm chạy test và so từng dòng bảng, nên **không thể trôi** khỏi hợp đồng mà build vẫn xanh:

| File | Nội dung |
|---|---|
| `error-codes.ts` | 24 code, HTTP status của từng code, và hai code duy nhất có `details` |
| `envelope.ts` | Envelope thành công và lỗi, field-error array, `currentVersion`, page và pagination query |
| `capabilities.ts` | 4 permission workspace, 24 permission project, ba role project, hai role workspace |
| `fields.ts` | Instant, calendar date, position, version, category, priority, `dueState`, `evidenceUrl` |
| `resources.ts` | Projection của workspace, project, column, task, member, comment, activity |
| `auth.ts`, `workspaces.ts`, `projects.ts`, `board-columns.ts`, `tasks.ts`, `comments.ts` | Request và response theo từng use case |

**Đã kiểm là test biết fail:** thêm một error code giả vào enum rồi chạy lại — test đổ đúng chỗ, khôi phục thì xanh lại. Một bộ đối chiếu chưa bao giờ đỏ là một bộ đối chiếu chưa được chứng minh.

`evidenceUrl` có test riêng vì nó là ranh giới bảo mật chứ không phải field tiện lợi: nó được render thành link người dùng sẽ bấm. Test xác nhận chỉ `https` được nhận, còn `http`, `javascript:`, `data:`, `file:`, đường dẫn tương đối và URL vượt 2048 ký tự đều bị từ chối.

### Một lỗ hổng hợp đồng lộ ra khi dịch

`requiresReviewer` có trong projection của column, có cột trong database, và [ADR-0001](decisions/ADR-0001-task-planning-fields-and-review-workflow.md) nói rõ Owner là người đánh dấu nó — nhưng **không route nào đặt được giá trị đó**. Đây là cùng loại lỗi với `is_terminal` trước đây: một ADR đã `Accepted` phụ thuộc vào một field không có đường điều khiển.

Đã sửa theo đúng lối mà `isTerminal` đang dùng, để hai field song song nhau thay vì mỗi field một kiểu: `requiresReviewer` vào body của `POST /projects/:projectId/columns` (optional, default `false`), thêm một command thứ tư `{ "requiresReviewer": boolean }` cho `PATCH /columns/:columnId`, sinh activity `board_column.reviewer_requirement_changed`, và một hàng transaction boundary tương ứng trong [chính sách query và index](data/query-and-index-policy.md).

Quy định kèm theo: đổi `requiresReviewer` **không hồi tố** — nó chỉ áp cho create và move sau thời điểm đổi. Task đang nằm trong cột mà thiếu `reviewerId` vẫn ở nguyên, vì hồi tố sẽ biến một thao tác cấu hình thành một đợt vi phạm invariant hàng loạt không ai yêu cầu.

## M0.3 — Mock server theo contract

Dựng mock phục vụ đúng các schema ở M0.2. Đây là thứ cho phép frontend chạy trước khi backend có endpoint, và là lý do M2–M4 song song được.

Mock phải trả cả **nhánh lỗi**, không chỉ nhánh thành công: `401`, `403`, `404`, `409` từng loại, `429` kèm `Retry-After`. Nếu mock chỉ biết trả `200`, frontend sẽ được viết như thể lỗi không tồn tại và mọi trạng thái UI sẽ phải làm lại.

### Đã dựng — trạng thái ngày 04/09/2026

Mock sống ở `packages/mock`, là workspace package thứ tư. Thêm một package là thay đổi package boundary, mà [cấu trúc repository](engineering/repository-structure.md) yêu cầu có ADR trước — nên quyết định này nằm ở [ADR-0012](decisions/ADR-0012-contract-mock-package.md), **chủ dự án đã duyệt 04/09/2026**. Nó được dựng trước khi ký vì trạng thái `Proposed` chỉ chặn thay đổi *khó đảo ngược*, còn xoá một package chỉ dùng cho dev thì không có gì để đảo.

| File | Nội dung |
|---|---|
| `fixtures.ts` | Dùng lại **đúng** bộ fixture chuẩn của [chiến lược kiểm thử](operations/testing-strategy.md): Project B có Owner/Editor/Viewer, một Workspace Admin không có `project_members` row, User A là Owner của Project A riêng tư. Cùng một tên actor mang cùng một nghĩa ở mọi lớp test. |
| `responses.ts` | Chỗ **duy nhất** biết hình dạng envelope. Nó tự chặn: gắn `details` cho một code không công bố `details` sẽ ném ngay, thay vì tạo ra response sai hợp đồng mà frontend lại tin. |
| `handlers.ts` | Handler theo use case, cộng 11 kịch bản lỗi gọi được trực tiếp để frontend dựng đủ mọi trạng thái đã thiết kế. |

**Cổng ra — đã đạt:** 63 test xác nhận **mọi** response của mock, cả thành công lẫn lỗi, parse được bằng chính schema trong `@flowboard/contracts`; status khớp danh mục; mọi `429` mang `Retry-After`; `VALIDATION_FAILED` dùng field-error array còn `TASK_VERSION_CONFLICT` dùng object `currentVersion`; và `X-Request-Id` trùng với `requestId` trong body.

**Ba giới hạn phải nhớ**, vì hiểu nhầm chúng là cách nhanh nhất để tin sai: mock **không** cưỡng chế phân quyền, concurrency hay idempotency; **không** giữ trạng thái giữa các request; và **không** được deploy. Một tính năng chỉ chạy đúng trên mock thì chưa chứng minh được gì — bằng chứng vẫn phải là integration test trên PostgreSQL thật.

## M0.4 — Token bridge và `packages/ui`

Pencil v0.1 có **171 biến `fb.*`** với hai theme. Không có bước nào đưa chúng vào code thì mỗi màn hình sẽ tự chế màu, và toàn bộ công kiểm tương phản ở giai đoạn thiết kế mất giá trị ngay ở dòng code đầu tiên.

1. **Xuất token thành CSS variable**, giữ nguyên tên `fb.*` để tra ngược về artifact được. Hai theme Light và Dark định nghĩa cùng một bộ tên, khác giá trị.
2. **Theme là một nguồn duy nhất**, theo [đặc tả tương tác](design/interaction-specifications.md). Không component nào tự đọc `prefers-color-scheme` riêng.
3. Wrapper trong `packages/ui` **không** tự fetch data, **không** kiểm tra role và **không** gọi API — đó là quy tắc ở [quy ước frontend](engineering/frontend-conventions.md). Component cần capability hoặc mutation thì thuộc về feature, không thuộc `packages/ui`.

### Đã dựng — trạng thái ngày 04/09/2026

`tokens.css` **được sinh ra**, không chép tay: [`scripts/generate-tokens.mjs`](../scripts/generate-tokens.mjs) đọc thẳng artifact đã freeze và phát ra CSS. Chép tay là tạo ra một bản sao thứ hai, và bản sao thứ hai luôn trôi khỏi bản gốc — chỉ là sớm hay muộn. Chạy lại bằng `pnpm tokens`.

Kết quả: **171 biến**, trong đó **83 biến có giá trị riêng cho theme tối**, tổng 254 khai báo CSS.

Script từ chối đoán ở hai chỗ, và cả hai đều làm nó **dừng** thay vì phát ra thứ sai:

- Artifact còn biến không mang tiền tố `fb.` thì dừng — nghĩa là remap chưa xong.
- Token số rơi ngoài ba họ đã biết đơn vị (`px`, `ms`, không đơn vị) thì dừng. Phát số trần ra CSS buộc mọi nơi dùng phải viết `calc(var(--fb-space-4) * 1px)`, và chỉ cần một chỗ quên là layout sai âm thầm.

Theme có **đúng một** nguồn quyết định: `[data-theme]` là lựa chọn tường minh của người dùng, còn khi không có thuộc tính đó thì đi theo `prefers-color-scheme`. Test khẳng định trong toàn bộ file chỉ có **một** media query theo `prefers-color-scheme`, nên không component nào có cớ tự đọc lại nó.

**Cổng ra — đã đạt:** 14 test xác nhận `tokens.css` là dẫn xuất trung thực của artifact — mọi biến trong artifact có mặt trong CSS, CSS không chứa biến nào artifact không có, đơn vị đúng theo từng họ, và theme chỉ có một nguồn quyết định. Không có test này thì `pnpm tokens` chỉ là một lời hứa: ai đó sửa tay một giá trị màu trong CSS và không gì phát hiện ra.

### Chín wrapper `Fb*` chuyển sang M1

Kế hoạch ban đầu đặt chín wrapper đầu tiên ở mốc này. Khi bắt tay vào thì lý do để chuyển chúng sang M1 rõ hơn lý do giữ lại: ở M0.4 chưa có màn hình nào render chúng, nên API của component sẽ được **đoán** thay vì rút ra từ nhu cầu thật, và mọi thứ đoán sai chỉ lộ ra khi M1 dựng `AUTH-01`.

Chúng vì vậy được dựng ở M1, ngay trước các màn hình dùng chúng, và vẫn đúng chín cái đó: `FbBrandMark`, `FbTextField`, `FbPasswordField`, `FbButtonPrimary`, `FbButtonSecondary`, `FbLink`, `FbAlert`, `FbChecklistRow`, `FbStatePanel`. Phần token — thứ mà mọi màn hình đều cần và không phụ thuộc màn hình nào — vẫn ở lại M0.4.

## M0.5 — Topology local và cổng CI

Theo [môi trường local](operations/local-development.md): Compose đúng **bốn** service `web`, `api`, `postgres`, `mailpit`. Không Redis, không BullMQ, không queue dashboard.

Theo [CI/CD](operations/ci-cd.md), CI phải chặn merge ở: format · lint · typecheck · unit · integration · build · E2E · container image · OpenAPI lint và breaking-change.

**Seed data lớn dần theo mốc, không dựng một lần.** Mỗi mốc mở rộng seed đúng phần dữ liệu mà mốc đó tạo ra bảng: M1 thêm user và session, M2 thêm workspace, project và membership của fixture chuẩn, M3 thêm column, M4 thêm task, comment và activity. Seed **không** được tạo account giống production, mật khẩu dùng chung hay token thật.

**Cổng ra:** một developer mới làm được năm bước trong tài liệu local — copy template env, start topology, chạy migration, nạp seed, chạy smoke journey — mà không phải tự chế config.

### Đã dựng — trạng thái ngày 04/09/2026

| Hạng mục | Nội dung |
|---|---|
| `apps/api` | Cấu hình validate lúc khởi động, `GET /health/live`, `GET /health/ready`, chuẩn hoá `requestId` |
| `apps/web` | Next.js 16 App Router; layout gốc là chỗ **duy nhất** nạp `tokens.css` |
| `infra/compose` | Đúng bốn service `web`, `api`, `postgres`, `mailpit`; named volume cho dữ liệu |
| `infra/docker` | Dockerfile multi-stage cho cả hai app |
| `.env.example` | Chỉ tên biến, mô tả và ví dụ không-secret |
| `.github/workflows/ci.yml` | Bốn job, tất cả chặn merge |
| `scripts/check-doc-links.py` | Bộ kiểm liên kết tài liệu, chạy trong CI |

**Liveness và readiness trả lời hai câu khác nhau**, và trộn chúng là lỗi vận hành thật. `live` không chạm dependency nào — fail nghĩa là restart process. `ready` kiểm PostgreSQL với timeout cứng — fail chỉ nghĩa là chưa phục vụ được. Healthcheck của Compose vì vậy dùng `live`: dùng `ready` sẽ khiến Compose restart API trong khi lỗi nằm ở database, mà restart không sửa được gì.

Ở mốc này **`ready` trả `503` một cách trung thực**, vì chưa có PostgreSQL client. Trả `ok` sẽ khiến Compose và orchestrator tin API phục vụ được trong khi nó chưa có gì để phục vụ. Probe thật được nối ở M1 cùng database boundary.

CI có thêm hai cổng mà bảng gốc chưa nêu, vì cả hai bảo vệ một quy tắc đã có: **token phải khớp artifact** (chạy lại `pnpm tokens` rồi `git diff --exit-code`, nên sửa tay `tokens.css` là fail), và **topology đúng bốn service** (không Redis, không worker — Phase 1.2 mới thêm, và phải kèm ADR).

### Ba lỗi thật lộ ra khi dựng

1. **`node --experimental-strip-types` không chạy được parameter property.** Cú pháp `constructor(public readonly x)` phải *sinh* code, mà chế độ chỉ bóc kiểu thì không sinh gì. Đã khai field tường minh — vốn cũng là cách viết rõ hơn.
2. **`.ts` trong import: Node chạy được, `tsc` emit thì không.** Chỉ lộ ra ở bước `build` vì `typecheck` chạy với `noEmit`. Bật `rewriteRelativeImportExtensions` để viết `./env.ts` mà emit ra `./env.js` — không có cờ này thì phải chọn một trong hai cách chạy, và cách còn lại sẽ hỏng đúng lúc cần.
3. **Bộ kiểm link chết vì chính thông báo của nó.** Console mặc định trên Windows là cp1252 và ném `UnicodeEncodeError` khi in tiếng Việt. Đã ép UTF-8 ngay đầu script.

Điểm thứ hai kéo theo một ràng buộc cho M1: **NestJS dùng decorator**, mà chế độ bóc kiểu của Node không hỗ trợ cú pháp sinh code. Vì vậy `start` và image Docker chạy `dist/main.js` đã build, không chạy thẳng source; chỉ `dev` mới dùng bóc kiểu.

**Cổng ra — đã đạt:**

- `pnpm verify` xanh trên cả năm workspace: format · lint · typecheck · build · test (115 test).
- API khởi động thật và trả đúng: `live` `200 {"status":"ok"}`, `ready` `503 {"status":"unavailable"}`, đường lạ trả `404` có envelope và `requestId`.
- `X-Request-Id` bẩn bị thay: gửi `bad id with spaces` thì server trả một ID mới do nó sinh, không phản chiếu lại chuỗi của client.
- `docker compose config` xác nhận đúng bốn service và một named volume.
- `scripts/check-doc-links.py` chạy sạch trên 65 tài liệu.

---

# M1 — Xác thực và phiên

**Đây là mốc duy nhất mà frontend và backend phải đi cùng nhịp**, vì cookie, CSRF token và vòng đời session dính chặt nhau; tách đôi ở đây chỉ tạo ra hai nửa không ghép được.

## Phạm vi

| Nhóm | Nội dung |
|---|---|
| Endpoint | `POST /auth/sign-up` · `POST /auth/email/verify` · `POST /auth/email/verification/resend` · `POST /auth/sign-in` · `GET /auth/session` · `POST /auth/sign-out` · `POST /auth/password/forgot` · `POST /auth/password/reset` |
| Màn hình | `AUTH-01`…`AUTH-05`, `SYS-02` (phiên hết hạn) |
| Error code | `VALIDATION_FAILED` · `UNAUTHENTICATED` · `EMAIL_VERIFICATION_REQUIRED` · `RATE_LIMITED` · `IDEMPOTENCY_KEY_REUSED` · `IDEMPOTENCY_IN_PROGRESS` |
| Migration | Bước 1 phần đầu: `users`, `auth_sessions`, `idempotency_records` |
| ADR ràng buộc | [ADR-0003](decisions/ADR-0003-opaque-session-authentication.md) opaque session · [ADR-0004](decisions/ADR-0004-drizzle-orm.md) Drizzle · [ADR-0007](decisions/ADR-0007-password-policy.md) chính sách mật khẩu |

## Thứ tự làm backend

1. **Database boundary trước tiên**: Drizzle schema, connection pool, migration runner, transaction helper. Đây là nền của mọi mốc sau nên làm cho đúng một lần.
2. **Bảng `idempotency_records` làm sớm**, ngay ở M1 chứ không để dành. Lý do: giao thức claim → mutation → outcome ([hợp đồng idempotency](api/pagination-concurrency-idempotency.md)) là thứ khó lắp thêm về sau vì nó thay đổi cách mọi use case mở transaction. `POST /auth/sign-up` và các route resend/forgot/reset đã cần nó ngay.
3. **Argon2id + NFKC normalization + chính sách mật khẩu theo độ dài và blocklist** — không phải quy tắc thành phần ký tự, theo ADR-0007.
4. **Opaque session**: sinh token, lưu hash (`session_token_hash`), cookie `HttpOnly` + `SameSite` + `Secure` ngoài local, CSRF token riêng qua `GET /auth/session`.
5. **`SessionGuard`** đặt đúng vị trí đầu chuỗi: `SessionGuard → ResourceProjectResolver → ProjectPermissionGuard → Zod → use case`. Ở M1 chưa có resource nên chỉ có mắt xích đầu, nhưng chuỗi phải dựng đúng hình ngay để M2 chỉ việc nối tiếp.
6. **Rate limit in-process** cho các route auth, kèm `Retry-After` trên `429`. Redis **không** thuộc core MVP — điều này đã được ghi rõ trong [quy ước API](api/api-conventions.md).
7. **Error mapper ở `shared/errors`** — một chỗ duy nhất dựng envelope. Controller và use case không tự chế shape lỗi riêng.

## Thứ tự làm frontend

1. Transport layer: gắn cookie, đọc CSRF token từ `GET /auth/session`, gắn `X-Request-Id`, và **vòng đời `Idempotency-Key`** theo [quy ước frontend](engineering/frontend-conventions.md#vòng-đời-idempotency-key-phía-client) — key sinh cho **một ý định của user**, giữ nguyên khi retry vì lỗi vận chuyển, xoay khi user sửa payload.
2. Dựng `AUTH-01`…`AUTH-05` theo frame đã freeze, gồm cả biến thể `error`, `validation`, `sent`, `pending`, `verified`, `link-expired`.
3. Checklist mật khẩu đúng ADR-0007: hai dòng kiểm tra live, còn blocklist là **field error sau khi submit** chứ không phải kiểm tra live — vì blocklist nằm ở server.
4. Xử lý `403 EMAIL_VERIFICATION_REQUIRED` đúng hợp đồng: xoá password khỏi form, chỉ giữ email trong form state tạm, chuyển sang `AUTH-05`, có nút gửi lại với rate limit riêng, và **không bao giờ tự retry sign-in**.

## Test bắt buộc

| Lớp | Nội dung |
|---|---|
| Unit | Chính sách mật khẩu, NFKC normalization, error mapper, `requestId` normalization |
| Integration | Session guard, CSRF, token dùng một lần và hết hạn, reset revoke mọi session trong **cùng một transaction**, rate limit trả `Retry-After` |
| E2E | Đăng ký → nhận mail ở Mailpit → xác minh → đăng nhập → đăng xuất; và nhánh đăng nhập khi chưa xác minh |
| Contract | Mỗi error code của mốc dựng đúng status và shape `details` |

## Failure experiment

**Mailpit không khả dụng.** Luồng email báo lỗi an toàn, không lộ token, **không tiết lộ email có tồn tại hay không**, và có log correlation để điều tra. Đây là experiment đúng cho M1 vì nó chạm cả ba thứ: xử lý lỗi phụ thuộc ngoài, chính sách không enumeration, và tính hữu dụng của `requestId`.

## Cổng ra — đã đạt ngày 04/09/2026

Toàn bộ mốc chạy thật trên PostgreSQL 17 và Mailpit trong Compose. `pnpm verify` xanh trên năm workspace với **292 test**.

| Cổng | Bằng chứng |
|---|---|
| Cookie session thật, không phải JWT | Cookie `HttpOnly` do server đặt; chỉ hash nằm trong database, token thô chỉ ở cookie |
| Chưa xác minh email trả đúng `403` | Gọi HTTP thật: `403 EMAIL_VERIFICATION_REQUIRED`, không session, không cookie, không CSRF token |
| Reset revoke mọi phiên trong **cùng** transaction | Integration test tạo hai phiên, reset, rồi xác nhận cả hai hết hiệu lực; và reset thất bại thì **không** phiên nào bị revoke |
| Token dùng một lần | Lần thứ hai bị từ chối; token đã dùng và token bịa cho **cùng** một thông điệp |
| Rate limit và `Retry-After` | 12 request liên tiếp: 8 lần `401` rồi `429` kèm `retry-after: 46` |
| CSRF | Thiếu token `403`, token sai `403`, token đúng `204` |
| Năm màn hình `AUTH-01`…`AUTH-05` | Đều trả `200`, render tiếng Việt, và màu đọc từ biến `--fb-*` sinh từ artifact |
| CORS | Chỉ `WEB_ORIGIN` đã cấu hình, kèm `credentials` |

### Ba quyết định bảo mật đáng ghi lại

**Thứ tự kiểm khi đăng nhập.** Xác thực mật khẩu **trước**, rồi mới kiểm email đã xác minh. Thứ tự ngược lại biến `403 EMAIL_VERIFICATION_REQUIRED` thành lời xác nhận rằng email đó có tài khoản. Cùng lý do, nhánh "không có user" vẫn băm một hash giả để thời gian phản hồi hai nhánh không lệch nhau đo được.

**Đăng ký không bao giờ báo email trùng.** Báo là biến trang đăng ký thành máy dò tài khoản. Response giống hệt nhau ở cả hai nhánh.

**CSRF token suy từ session token, không lưu.** Không cần cột, không cần tra database, không dùng chéo phiên được, và kẻ tấn công cross-site khiến trình duyệt gửi cookie nhưng không đọc được nó thì cũng không tính ra được giá trị.

### Vòng đời `Idempotency-Key` phía client

Key sống trong `ref` nên nó không đổi khi component render lại. Nó **giữ nguyên** khi gửi lại vì lỗi vận chuyển — đó là toàn bộ lý do key tồn tại — và **xoay** khi người dùng sửa payload. Transport không tự xoay key ở bất kỳ đâu: quyết định đó thuộc về chỗ biết ý định của người dùng.

### Bốn lỗi tìm ra khi chạy thật

1. **Nest mặc định POST là `201`**, nên `email/verify` và `sign-in` trả `201` trong khi hợp đồng ghi `200`. Chỉ lộ ra khi gọi endpoint thật, không lộ khi đọc code.
2. **`Date` trong `sql` template thô** không được gắn kiểu `timestamptz` — lần thứ hai. Cả hai chỗ nay dùng operator có kiểu.
3. **Testing Library chỉ tự dọn DOM khi `globals: true`.** Với `globals: false`, phải đăng ký `afterEach(cleanup)` tường minh; thiếu nó thì test sau tìm thấy phần tử của test trước.
4. **`packages/ui` để `jsx: "preserve"`** theo preset dùng chung, nhưng nó là **thư viện** chứ không phải app Next: nó phải tự transform JSX, nếu không mọi consumer đều nhận JSX thô.

### Một rule của tôi sai, không phải code sai

Pattern lint chặn `../../../*` được viết với ý "không leo ra ngoài package". Bên trong `apps/api`, một module import `shared/` là **đúng** quan hệ mà backend conventions quy định, và đường dẫn của nó tự nhiên vượt ba cấp. Một rule bắt nhầm việc đúng sẽ bị tắt đi, và khi đó nó không bảo vệ gì nữa — nên pattern đã bị bỏ, kèm lý do ghi ngay tại chỗ nó từng nằm. Hai pattern còn lại vẫn bắt vi phạm thật, đã kiểm lại bằng file thử.

---

# M2 — Workspace và project scope

Từ mốc này trở đi **frontend và backend chạy song song được**, vì hợp đồng đã cố định và mock đã có.

## Phạm vi

| Nhóm | Nội dung |
|---|---|
| Endpoint | `GET /workspaces` · `POST /workspaces` · `GET|POST|DELETE /workspaces/:workspaceId/members[/:userId]` · `POST /workspaces/:workspaceId/projects` · `GET /projects/:projectId` · `PATCH /projects/:projectId` · `POST|PATCH|DELETE /projects/:projectId/members[/:userId]` |
| Màn hình | `WSP-01`…`WSP-04`, `PRJ-01`, `PRJ-02`, `PRJ-03`, `PRM-01`, `USR-01`, `SYS-01`, `SYS-05` |
| Error code | `FORBIDDEN` · `NOT_FOUND` · `VALIDATION_FAILED` |
| Migration | `workspaces`, `workspace_members`, `projects`, `project_members` |

## App shell dựng ở đây, không sớm hơn và không muộn hơn

Màn hình `AUTH-*` của M1 không có sidebar; app shell chỉ xuất hiện khi đã có workspace để điều hướng. Vì vậy M2 là chỗ dựng `FbSidebar`, `FbSidebarCollapsed`, `FbTopbar`, `FbMobileHeader` và `FbAccountMenu`, theo hai frame tham chiếu `REF-05` (sidebar mở rộng) và `REF-06` (sidebar thu gọn).

`USR-01` cũng thuộc mốc này chứ không phải mốc task: nó là trang hồ sơ và tùy chọn, **không có mutation phía server** — chỉ hiển thị actor của session, cho chọn theme cục bộ và cho thấy múi giờ dữ liệu đang dùng. Entry point là khối người dùng trên topbar, theo quyết định của chủ dự án ngày 03/09/2026; footer sidebar chỉ còn control thu gọn.

## Điểm phải làm đúng ngay từ đầu

**`shared/authorization` là kernel đọc membership và role.** Theo [ADR-0005](decisions/ADR-0005-module-dependency-and-activity-boundary.md) đây là ngoại lệ có chủ đích trong đồ thị phụ thuộc: nó không import module nào, và không module nào tự đọc `project_members` để tự quyết quyền.

**`ID` là locator, không phải chứng cứ quyền.** `ResourceProjectResolver` lấy project chủ sở hữu từ chính resource; repository tiếp tục ràng buộc `project_id` trong mọi query. Hai lớp này độc lập nhau và **cả hai đều bắt buộc** — bỏ lớp thứ hai là để lộ dữ liệu ngay khi lớp thứ nhất có bug.

**Workspace Admin không có quyền ngầm định.** Một Workspace Admin chưa có dòng trong `project_members` phải nhận `404` trên project riêng tư, chứ không phải `403` — vì `403` đã là một tín hiệu xác nhận project đó tồn tại.

**`capabilities` do server tính** và trả trong projection. Frontend dùng `can(action, resource)`; **không** encode điều kiện Owner/Editor/Viewer trực tiếp trong page.

## Test bắt buộc

Đây là mốc đầu tiên chạm [ma trận test phân quyền](security/authorization-test-matrix.md), nên dựng luôn fixture chuẩn và dùng lại cho mọi mốc sau:

- Project B có Owner, Editor, Viewer; User B là Owner.
- Một Workspace Admin **không có** dòng `project_members` cho Project B.
- User A là Owner của Project A riêng tư trong cùng workspace, không có membership Project B.

## Failure experiment

**Thay ID resource của project riêng tư khác vào URL.** Server trả `404` và không xác nhận project kia tồn tại — không qua body, không qua status, không qua thời gian phản hồi khác biệt rõ rệt. Chỉ thành viên project nhìn thấy được nhưng thiếu quyền mới nhận `403`.

## Cổng ra

- Ma trận phân quyền cho nhóm workspace và project xanh ở lớp unit; hai đường rủi ro cao xanh ở lớp integration.
- Không endpoint nào trả count, metadata hay existence signal của project mà actor không phải thành viên.

---

# M3 — Board column

Mốc nhỏ nhưng đặt nền cho hai thứ mà M4 dựa vào: **fractional ordering** và **cờ `is_terminal`**.

## Phạm vi

| Nhóm | Nội dung |
|---|---|
| Endpoint | `POST /projects/:projectId/columns` · `PATCH /columns/:columnId` · `POST /columns/reorder` |
| Màn hình | `BRD-02` |
| Error code | `COLUMN_NOT_EMPTY` |
| Migration | `board_columns` cùng `UNIQUE (project_id, position)` dạng `DEFERRABLE INITIALLY IMMEDIATE` |
| ADR ràng buộc | [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md) ordering · [ADR-0008](decisions/ADR-0008-terminal-column-and-task-reopen.md) cột terminal |

## Điểm phải làm đúng

**Fractional ordering làm ở đây trước, không phải ở M4.** Column ít hơn task nhiều nên đây là chỗ rẻ để chứng minh thuật toán đúng: `numeric(20,10)`, spacing khởi tạo 1024, chèn giữa lấy trung điểm, rebalance khi khoảng cách xuống dưới 10⁻⁶. Học ở column rồi mới áp cho task.

**`ColumnEmptinessCheck` là port, không phải import chéo.** Use case archive của `board-columns` định nghĩa port trong domain của nó; module `tasks` implement adapter; composition root nối lại. Đây là cách đồ thị phụ thuộc giữ được tính acyclic — dùng `forwardRef` để che cycle là vi phạm review.

**`is_terminal` phải có ngay từ migration này**, dù tác dụng của nó (`dueState`, `task.reopened`) chỉ thấy ở M4. Thêm cột vào sau là một migration trên bảng đã có dữ liệu, đắt hơn nhiều.

## Failure experiment

**Archive một cột còn task.** Trả `409 COLUMN_NOT_EMPTY`, **không tự dời task đi đâu cả**. Việc dời task là quyết định của người dùng, không phải tác dụng phụ của thao tác archive.

---

# M4 — Task, comment và activity

Đây là mốc lớn nhất và là vòng lặp chính của sản phẩm.

## Phạm vi

| Nhóm | Nội dung |
|---|---|
| Endpoint | `GET /projects/:projectId/tasks` · `POST /projects/:projectId/tasks` · `GET /tasks/:taskId` · `PATCH /tasks/:taskId` · `POST /tasks/:taskId/move` · `POST /tasks/:taskId/comments` · `GET /tasks/:taskId/activity` |
| Màn hình | `BRD-01` mọi biến thể (owner, editor, viewer, column-states, dnd-syncing, mobile), `TSK-01`, `TSK-02`, `MYT-01`, `PRJ-04`, `SYS-04` |
| Error code | `TASK_VERSION_CONFLICT` cùng toàn bộ code chung |
| Migration | `tasks`, `comments`, `activity_logs`; composite FK `(project_id, x)`; `CREATE EXTENSION unaccent` và `fb_unaccent(text)` **trước** GIN index |
| ADR ràng buộc | [ADR-0001](decisions/ADR-0001-task-planning-fields-and-review-workflow.md) · [ADR-0005](decisions/ADR-0005-module-dependency-and-activity-boundary.md) · [ADR-0006](decisions/ADR-0006-fractional-ordering-and-concurrency.md) · [ADR-0008](decisions/ADR-0008-terminal-column-and-task-reopen.md) · [ADR-0009](decisions/ADR-0009-task-evidence-and-comment-formatting.md) |

## Thứ tự làm — chia nhỏ để mỗi bước tự chứng minh được

1. **Task đọc trước, ghi sau.** `GET /projects/:projectId/tasks` với đủ filter, sort, cursor và search. Làm search **cùng lúc** với list chứ không để dành: `fb_unaccent` phải đối xứng hai phía (index và query), nếu không thì `thiet ke` không khớp `thiết kế` — người Việt gõ không dấu thường xuyên nên đây là yêu cầu UX, không phải tối ưu.
2. **`ActivityRecorder.record(tx, event)`** dựng ngay, trước mutation đầu tiên. Module `activity` là leaf sở hữu `activity_logs`; **không module nào insert trực tiếp**. Lắp sau sẽ phải sửa mọi use case đã viết.
3. **Create và update task** với `expectedVersion`, `409 TASK_VERSION_CONFLICT` trả `details.currentVersion`.
4. **Move task** — phần khó nhất. Transaction riêng, lock vừa đủ, fractional ordering có rebalance, unique constraint `DEFERRABLE` hoãn tới lúc commit. **Rebalance chỉ ghi `position`**: không tăng `version`, không chạm `updated_at` của các hàng bị ghi lại — nếu không, client đang mở màn hình sẽ nhận `409` giả và seek pagination theo `updatedAt` sẽ xáo.
5. **Comment** — plain text bất biến, render Markdown theo **allowlist tường minh** ở [quy ước frontend](engineering/frontend-conventions.md): bold, italic, inline code, code block, list, link. Raw HTML tắt tuyệt đối. Link chỉ `https`, `http`, `mailto` và luôn có `rel="noopener noreferrer"`.
6. **`evidenceUrl`** render như link kèm host dạng text để người đọc thấy đích trước khi bấm; **không** fetch preview, thumbnail, favicon hay metadata ở bất kỳ tầng nào.
7. **Cột terminal và reopen**: move vào cột `is_terminal = true` thì `dueState` chuyển `none` và task rời khỏi filter `overdue`; move ngược ra ghi **đúng một** `task.reopened`, không kèm `task.moved`.

## Frontend — bốn chỗ dễ sai

- **Optimistic update chỉ dùng khi rollback được chính xác.** DnD chỉ tạo command `destinationColumnId` + `targetPosition` + `expectedVersion`; **server là nguồn duy nhất của position và version mới**.
- **Cache key là fingerprint canonical của filter.** Một response của filter cũ về sau response của filter mới thì không có chỗ ghi vào — đây chính là cách chống read race.
- **Version guard khi refetch**: một refetch trả `version` thấp hơn không được ghi đè state đã được server xác nhận.
- **Cursor của một column không dùng cho column khác.**

## Failure experiment — bốn cái, không phải một

| Thí nghiệm | Điều phải quan sát được |
|---|---|
| Hai mutation đồng thời cùng `expectedVersion` | Request sau nhận `409` kèm `currentVersion`; **không** Task và **không** ActivityLog nào được ghi cho request thua |
| Chèn N task liên tiếp vào cùng một khe vượt ngưỡng rebalance | Rebalance trong cùng transaction; thứ tự giữ nguyên; **không unique violation ở mọi mức N**, kể cả N vượt ~43 lần chia đôi làm cạn precision của `numeric(20,10)` |
| Kill API process giữa một transaction | Sau khi chạy lại không có partial write; ActivityLog chỉ tồn tại cùng transaction với mutation đã commit |
| Đổi filter rồi tái dùng cursor cũ | `400 VALIDATION_FAILED`; client về trang đầu với filter canonical mới |

## Cổng ra

Vòng lặp Owner/Editor/Viewer chạy end-to-end qua browser, gồm: Viewer gọi HTTP trực tiếp bị từ chối, truy cập chéo project bị từ chối, và conflict có đường xem lại dữ liệu hiện tại thay vì ghi đè âm thầm.

---

# M5 — Hoàn thiện, ma trận quyền và vận hành

Mốc này không thêm feature. Nó biến thứ đang chạy được thành thứ **vận hành được và chứng minh được**.

| Hạng mục | Nội dung | Nguồn |
|---|---|---|
| Trạng thái UI | Loading, empty, network error, forbidden, validation, session expired, conflict — mọi màn, cả Light và Dark | `SYS-03`, `SYS-06`, các biến thể state đã freeze |
| Ma trận phân quyền | Toàn bộ ô Allow/Deny ở lớp unit; đường rủi ro cao ở integration và E2E | [ma trận test](security/authorization-test-matrix.md) |
| Chống trôi ma trận phái sinh | Assertion: **không affordance nào trong ma trận visibility cấp một action mà catalog Deny** | [chiến lược test](operations/testing-strategy.md) |
| Observability | `requestId` xuyên suốt; log Pino có `level`, `time`, `requestId`, `method`, `route`, `statusCode`, `durationMs`, `module`; readiness và liveness | [observability](operations/observability.md) |
| Kiểm chứng index | `EXPLAIN (ANALYZE, BUFFERS)` trước và sau index với dữ liệu phân bố đại diện | [chính sách query và index](data/query-and-index-policy.md) |

**Điểm dễ bị bỏ qua:** metric nhóm *Invariant guard* — đếm số lần rebalance theo project và column — thuộc core MVP chứ không phải phase sau, vì ordering có từ đầu. Đây là **revisit trigger đã ghi trong ADR-0006**: nếu rebalance xảy ra thường xuyên thì spacing và ngưỡng phải được xem lại. Không đo thì không bao giờ biết để xem lại.

## Failure experiment

**Stop rồi start lại container PostgreSQL.** Dữ liệu còn nguyên nhờ named volume; xoá dữ liệu chỉ xảy ra qua lệnh reset tường minh nhắm đúng database và volume.

---

# M6 — Phase 1.1: export tiến độ

| Nhóm | Nội dung |
|---|---|
| Endpoint | `POST /projects/:projectId/reports/progress-export` · `GET /reports/:reportId` · `GET /reports/:reportId/download` |
| Màn hình | `RPT-01` |
| Error code | `REPORT_NOT_READY` · `REPORT_EXPIRED` |
| Migration | `report_exports` và index liên quan — **chỉ ở phase này** |

**Vẫn chưa có Redis, worker hay BullMQ.** Owner chủ động tải một file; chưa có delivery bất đồng bộ nên chưa có lý do để thêm queue. Thêm sớm là tăng thành phần vận hành mà chưa hoàn tất thêm một nhu cầu người dùng nào.

**Failure experiment:** gửi lại export request với cùng `Idempotency-Key`, cùng actor, cùng canonical payload → nhận lại **cùng** export record, không có bản thứ hai; cùng key với payload khác bị từ chối bằng `409 IDEMPOTENCY_KEY_REUSED`.

---

# Sau M6

| Phase | Điều kiện mở | Ghi chú |
|---|---|---|
| **1.2** worker và delivery | Khi report delivery thật sự bất đồng bộ | Lúc này mới thêm Redis, BullMQ, `apps/worker`. Cần ADR, cập nhật topology, health, backup, telemetry và test **cùng lúc** |
| **1.3** Time Tracking | Sau khi task, permission và concurrency đã kiểm chứng | Thiết kế **đã có** trong Pencil v0.1 (`TTS-01`, `WTL-01/02`, `WTA-01`, `WTR-01`) |
| **1.4** Sprint | Sau 1.3 | Hợp đồng và schema đã có; **thiết kế chưa có** — cần Pencil v0.2 trước |
| **1.5** Quan hệ task | Sau 1.4 | Hợp đồng và schema đã có; **thiết kế chưa có** — cần Pencil v0.2 trước |

Phase 1.4 và 1.5 đều dựa vào `board_columns.is_terminal`, nhưng **không phụ thuộc dữ liệu của nhau**: một project có thể bật Sprint mà không dùng quan hệ task và ngược lại.

---

# Frontend và backend song song đến đâu

| Giai đoạn | Song song được? | Lý do |
|---|---|---|
| M0 | **Không** | Đường nối hợp đồng phải cố định trước, nếu không hai bên trôi khỏi nhau |
| M1 | **Không** — đi cùng nhịp | Cookie, CSRF và vòng đời session dính chặt; tách đôi cho ra hai nửa không ghép được |
| M2 · M3 · M4 | **Có** | Hợp đồng cố định, mock trả cả nhánh lỗi; hai bên gặp nhau ở integration |
| M5 | **Có**, nhưng E2E cần cả hai xong | Ma trận phân quyền chạy xuyên app |
| M6 | **Có** | |

**Ba chỗ luôn phải đồng bộ dù ở mốc nào**, vì mỗi bên hiểu lệch là sinh lỗi thật chứ không phải lỗi hiển thị:

1. **`expectedVersion` → `409`** — frontend giữ bản nháp, backend trả đủ dữ liệu để dựng màn resolution.
2. **`Idempotency-Key`** — frontend sinh và giữ key theo *ý định của user*, backend trả `409 IDEMPOTENCY_IN_PROGRESS` kèm `Retry-After`.
3. **`capabilities` per-record** — backend tính và trả; frontend chỉ đọc, không tự suy từ status, ngày hay tác giả.

---

# Nợ hợp đồng đã biết

Bảng này ghi những chỗ hợp đồng còn thiếu hoặc tự mâu thuẫn, phát hiện trong lúc triển khai. Nó tồn tại để không ai phải phát hiện lại lần thứ hai, và để chỗ nào cần owner quyết thì không bị lặng lẽ quyết thay.

| Khoảng trống | Trạng thái | Ghi chú |
|---|---|---|
| `409 CONFLICT` được dùng ở bốn chỗ nhưng không có trong danh mục error code | **Đã sửa 04/09/2026** | Thay bằng bốn code riêng: `PROJECT_LAST_OWNER`, `MEMBER_HAS_ASSIGNED_TASKS`, `WORKSPACE_MEMBER_IN_PROJECTS`, `TASK_DEPENDENCY_DUPLICATE`. Danh mục nay có 28 code. Chúng **không** phải optimistic concurrency: tải lại rồi gửi lại không giải quyết gì, người dùng phải đổi thứ tự thao tác |
| Không có route trả danh sách project của một workspace, dù `PRJ-01` là màn bắt buộc | **Đã sửa 04/09/2026** | Thêm `GET /workspaces/:workspaceId/projects`, chỉ trả project mà actor có `project_members` row, không trả count thành viên hay count task |
| `GET /workspaces/:workspaceId/members` khai trả "workspace capabilities" nhưng envelope list là `{ items, page }` | **Đã sửa 04/09/2026** | Bỏ khẳng định đó; caller đã có capabilities từ `GET /workspaces` |
| `GET /projects/:projectId` khai trả task theo từng column, nhưng `projectDetailSchema` không có field task | **Đã sửa 04/09/2026** | Nói rõ `columns` vào từ M3 và `tasks` từ M4; ở M2 trả mảng rỗng |
| `USR-01` đòi hiển thị múi giờ workspace mà không projection nào có | **Đã sửa 04/09/2026** | Bỏ khỏi phạm vi màn hình; múi giờ vào schema ở mốc dựng `tasks`, vì `dueDate` được định nghĩa theo nó |
| `POST /workspaces` không có capability để gate CTA | **Đã làm rõ 04/09/2026** | Chủ đích: client luôn hiện CTA rồi xử lý `403`. Ẩn nó sẽ chặn đúng người vừa được cấp quyền |
| **Không có đường tra cứu người dùng để thêm workspace member** | **[ADR-0013](decisions/ADR-0013-workspace-member-invitation.md) đang `Proposed`, chờ owner ký** | `POST /workspaces/:workspaceId/members` nhận `{ userId }` là UUID, nên form thêm thành viên buộc người dùng dán UUID — không dùng được trong thực tế. Sửa nó là quyết định về sản phẩm **và** về bảo mật, không phải một chi tiết hợp đồng: mời theo email làm bề mặt enumeration, còn thêm endpoint tra cứu user cũng vậy. Tôi cố ý **không** tự quyết thay owner. Xem mục dưới |

## Thêm workspace member: cần owner quyết

Hôm nay `POST /workspaces/:workspaceId/members` nhận `{ userId, role }`, và không có endpoint nào cho phép tìm `userId` từ một cái tên hay email. Frontend vì vậy chỉ có thể cho dán UUID.

Ba phương án, và cái giá của từng cái:

| Phương án | Được | Mất |
|---|---|---|
| Mời theo email, tạo lời mời chờ | Dùng được ngay; không cần biết user có tồn tại | Thêm khái niệm lời mời vào MVP — một thực thể, một vòng đời, và các màn hình đi kèm |
| Thêm `GET /users?email=` cho Workspace Admin | Sửa nhỏ nhất | Là một máy dò tài khoản có kiểm quyền. Cần rate limit và audit riêng, và vẫn nói cho admin biết email nào đã đăng ký |
| Giữ nguyên UUID | Không thêm gì | Không ai dùng được. Thực chất là hoãn, chứ không phải một quyết định |

Cả ba đều là quyết định về vòng đời danh tính, nên chúng được ghi thành [ADR-0013](decisions/ADR-0013-workspace-member-invitation.md), hiện `Proposed`.

Một dự kiện đã loại bỏ phương án tra cứu, chứ không phải sở thích: chính sách cấp workspace mà implementation đã chọn là **bất kỳ ai xác minh email đều tạo được workspace và thành admin của nó**. Vì vậy một endpoint tra cứu "chỉ dành cho Workspace Admin" không thu hẹp gì — nó là một oracle dò email mở cho mọi người đăng ký. Rate limit và audit làm nó chậm hơn, không làm nó thôi là oracle.

ADR khuyến nghị **mời theo email**, tái dùng đúng lối token và lối `202` generic đã dựng ở M1. Nó đang chặn phần "thêm thành viên" của `WSP-03`; phần còn lại của M2 không bị chặn.

# Rủi ro đã biết

| Rủi ro | Vì sao có thật | Cách xử lý trong kế hoạch |
|---|---|---|
| Idempotency lắp muộn | Giao thức claim → mutation → outcome đổi cách **mọi** use case mở transaction | Làm ở M1, trước use case thứ hai |
| `ActivityRecorder` lắp muộn | Mọi mutation phải ghi activity trong cùng transaction | Dựng ở đầu M4, trước mutation đầu tiên |
| Cột `is_terminal` thêm sau | Migration trên bảng đã có dữ liệu | Đưa vào migration của M3 |
| Rebalance làm `409` giả | Nếu rebalance chạm `version` hoặc `updated_at` | Ràng buộc rõ ở M4 kèm test riêng |
| Search không đối xứng dấu | `thiet ke` không khớp `thiết kế` | Làm search cùng lúc với list ở M4 |
| Frontend viết như thể lỗi không tồn tại | Mock chỉ trả `200` | M0.3 bắt buộc mock trả cả nhánh lỗi |
| Hai ma trận phái sinh trôi khỏi catalog | Ma trận visibility là phái sinh của permission catalog | Assertion chống trôi ở M5 |
| Màu viết thẳng trong code | Token chỉ nằm trong artifact, không ai đưa vào code | Token bridge ở M0.4, trước bất kỳ UI nào |
| Seed dựng một lần rồi lạc hậu | Bảng sinh ra dần theo mốc | Seed lớn dần theo từng mốc, quy tắc ghi ở M0.5 |

---

# Những gì kế hoạch này **không** quyết định

Các mục sau cần ADR riêng **trước khi** code, theo [quy trình ADR](decisions/README.md):

- Chọn provider và cơ chế queue khi mở Phase 1.2.
- Cơ chế lưu trữ file export nếu vượt quá nhu cầu download trực tiếp.
- Bất kỳ thay đổi nào về ranh giới package, sở hữu migration, cơ chế session, hay chiến lược ordering.
- Bất kỳ thay đổi nào của hợp đồng đã chốt — sửa hợp đồng trước, code sau.

Kế hoạch này là tài liệu sống: khi một mốc lộ ra rằng thứ tự ở đây sai, sửa ở đây và ghi lại lý do, đừng đi vòng trong lúc code.
