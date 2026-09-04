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
| Hợp đồng Markdown | Chốt ở baseline v0.1; 11 ADR đều `Accepted` |
| Thiết kế Pencil | **Freeze v0.1 ngày 04/09/2026**, blob `12d6ff91`; checklist 34/34 |
| Danh mục error code | 24 code, đóng — không code nào ngoài danh mục được xuất hiện trong response |
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
| `ErrorCode` enum | [danh mục error code](api/endpoint-contracts.md#danh-mục-error-code) | **Đủ 24 code, không hơn không kém** |
| Envelope thành công và lỗi | quy ước API | `{ code, message, requestId, details? }` |
| Tên capability | [mô hình phân quyền](security/authorization-model.md) | Dùng chung cho `can(action, resource)` |
| Hình dạng cursor | [chính sách query và index](data/query-and-index-policy.md) | Cursor gắn fingerprint của filter/sort |

`packages/contracts` **không** được phụ thuộc Drizzle, NestJS, Next.js hay React. Contract diễn đạt use case cụ thể (`moveTask`), không diễn đạt bảng.

**Cổng ra đo được:** một test đối chiếu hai chiều — mọi code trong `ErrorCode` có mặt trong danh mục Markdown, và mọi code trong danh mục có mặt trong enum. Lệch một code là fail.

## M0.3 — Mock server theo contract

Dựng mock phục vụ đúng các schema ở M0.2. Đây là thứ cho phép frontend chạy trước khi backend có endpoint, và là lý do M2–M4 song song được.

Mock phải trả cả **nhánh lỗi**, không chỉ nhánh thành công: `401`, `403`, `404`, `409` từng loại, `429` kèm `Retry-After`. Nếu mock chỉ biết trả `200`, frontend sẽ được viết như thể lỗi không tồn tại và mọi trạng thái UI sẽ phải làm lại.

## M0.4 — Token bridge và `packages/ui`

Pencil v0.1 có **171 biến `fb.*`** với hai theme. Không có bước nào đưa chúng vào code thì mỗi màn hình sẽ tự chế màu, và toàn bộ công kiểm tương phản ở giai đoạn thiết kế mất giá trị ngay ở dòng code đầu tiên.

1. **Xuất token thành CSS variable**, giữ nguyên tên `fb.*` để tra ngược về artifact được. Hai theme Light và Dark định nghĩa cùng một bộ tên, khác giá trị.
2. **Theme là một nguồn duy nhất**, theo [đặc tả tương tác](design/interaction-specifications.md). Không component nào tự đọc `prefers-color-scheme` riêng.
3. **Dựng trước các wrapper mà M1 cần**, không dựng cả 25 component: `FbBrandMark`, `FbTextField`, `FbPasswordField`, `FbButtonPrimary`, `FbButtonSecondary`, `FbLink`, `FbAlert`, `FbChecklistRow`, `FbStatePanel`. Các component còn lại dựng đúng lúc mốc cần chúng.
4. Wrapper trong `packages/ui` **không** tự fetch data, **không** kiểm tra role và **không** gọi API — đó là quy tắc ở [quy ước frontend](engineering/frontend-conventions.md). Component cần capability hoặc mutation thì thuộc về feature, không thuộc `packages/ui`.

**Cổng ra đo được:** không một giá trị màu nào viết thẳng trong code frontend; mọi màu đọc từ CSS variable sinh ra từ token. Đây là cùng một tiêu chí mà artifact đã đạt (0 hex ghi cứng), chỉ chuyển sang phía code.

## M0.5 — Topology local và cổng CI

Theo [môi trường local](operations/local-development.md): Compose đúng **bốn** service `web`, `api`, `postgres`, `mailpit`. Không Redis, không BullMQ, không queue dashboard.

Theo [CI/CD](operations/ci-cd.md), CI phải chặn merge ở: format · lint · typecheck · unit · integration · build · E2E · container image · OpenAPI lint và breaking-change.

**Seed data lớn dần theo mốc, không dựng một lần.** Mỗi mốc mở rộng seed đúng phần dữ liệu mà mốc đó tạo ra bảng: M1 thêm user và session, M2 thêm workspace, project và membership của fixture chuẩn, M3 thêm column, M4 thêm task, comment và activity. Seed **không** được tạo account giống production, mật khẩu dùng chung hay token thật.

**Cổng ra:** một developer mới làm được năm bước trong tài liệu local — copy template env, start topology, chạy migration, nạp seed, chạy smoke journey — mà không phải tự chế config.

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

## Cổng ra

- Cookie session thật chạy được qua browser, không phải JWT.
- Đăng nhập khi chưa xác minh trả **đúng** `403 EMAIL_VERIFICATION_REQUIRED`, không tạo session, không cookie, không CSRF token, không dữ liệu riêng tư.
- Reset mật khẩu revoke mọi session đang hoạt động trong cùng transaction — chứng minh bằng integration test, không bằng suy luận.
- Gửi lại cùng `Idempotency-Key` cho `sign-up` không tạo user thứ hai.

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
