# Chiến lược kiểm thử Flowboard

Tài liệu này xác định trách nhiệm kiểm thử trước khi Flowboard có runtime. Nó cụ thể hóa Section 11 của [baseline đã phê duyệt](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md), [API conventions](../api/api-conventions.md), hợp đồng [concurrency và idempotency](../api/pagination-concurrency-idempotency.md), và [authorization test matrix](../security/authorization-test-matrix.md). Không một lớp test nào thay thế lớp khác.

## Mục tiêu và nguyên tắc

- Kiểm thử behavior và invariant của use case cụ thể; không kiểm thử một generic CRUD surface không tồn tại trong MVP.
- Giữ test gần owner: domain/module test ở API module, component/feature test ở web feature, còn journey xuyên app nằm ở E2E.
- Test phải độc lập, tạo fixture riêng và không phụ thuộc thứ tự. Integration/E2E dùng database và namespace dữ liệu tách biệt để có thể chạy song song.
- Mỗi lỗi trả về phải giữ envelope đã công bố, gồm `requestId`; test không chấp nhận stack trace, SQL, token, session value hay existence signal của private project.
- Test chứng minh side effect lẫn response: mọi deny, validation failure, idempotent replay và stale conflict phải xác nhận không có mutation hoặc `ActivityLog` ngoài outcome được phép.

## Trách nhiệm theo lớp

| Lớp | Owner và môi trường | Chứng minh | Không thay thế |
|---|---|---|---|
| Unit | Module domain, policy, Zod schema, mapper và shared primitive có contract hẹp; Vitest | permission mapping, allowlist, canonicalization, error mapping, cursor codec, requestId normalization | transaction, SQL scope hay browser journey |
| Integration | Nest use case/repository với PostgreSQL thật; Vitest | transaction, project-scoped query, migration compatibility, pagination, idempotency, session/CSRF guard và optimistic concurrency | accessibility, browser cookie behavior hay drag interaction hoàn chỉnh |
| E2E | Next.js + API + PostgreSQL trong topology CI; Playwright | journey chính, cookie/session, role affordance, network/error/conflict recovery, keyboard và pointer drag | toàn bộ matrix SQL/guard branch |
| Contract | API build/OpenAPI và HTTP fixture | path, schema, status, error-code variant, `X-Request-Id`/envelope | business invariant chưa được endpoint công bố |
| Failure experiment | environment không-production, tách dữ liệu | graceful degradation, rollback, timeout và recovery runbook | test thường xuyên của pull request |

Contract layer sở hữu thêm một kiểm tra hai chiều với [danh mục error code](../api/endpoint-contracts.md#danh-mục-error-code): mọi code trong danh mục phải có ít nhất một contract test dựng đúng status và `details` shape của nó, và **không** code nào ngoài danh mục được xuất hiện trong response của bất kỳ test nào. Đây là tiêu chí duy nhất cho error code — không kiểm bằng cách đòi code phải xuất hiện ở hai tài liệu, vì `api-conventions.md` cố ý chỉ giữ quy tắc envelope và trỏ tới danh mục.

## Authorization là quality gate bắt buộc

[Authorization test matrix](../security/authorization-test-matrix.md) là nguồn đầy đủ của role/action coverage. Unit test phải đánh giá mọi cell Allow/Deny; integration và E2E phải chọn các đường đi có rủi ro cao để chứng minh frontend không phải authorization boundary.

Fixture chuẩn có một workspace và hai private project:

- Project B có `Owner`, `Editor`, `Viewer` và User B là Owner/owner của resource mục tiêu.
- Một Workspace Admin không có `project_members` row cho Project B.
- User A là Owner của private Project A trong cùng workspace nhưng không có membership Project B.

Tối thiểu phải có các test sau:

| Test | Lớp tối thiểu | Expected result |
|---|---|---|
| Full role matrix | Unit | `AuthorizationService.can` khớp từng ô; Workspace Admin không tự có project permission. |
| Direct HTTP của Viewer | Integration | Mọi mutation Project B bị `403`, không có mutation hay activity row. |
| User A/User B ID substitution | Integration và một E2E journey | User A dùng task/comment/column/report ID của User B nhận `404`, không có data, count hoặc existence signal. |
| Parent/child không khớp | Integration | Parent ID client không override ownership đã resolver xác định; request bị deny trước repository mutation. |
| Capability affordance | E2E | UI dùng `can(action, resource)` để ẩn/disable control nhưng API vẫn là quyết định cuối cùng. |
| Response field exposure | Contract và integration | Denied envelope không chứa protected data; success chỉ có projection được endpoint cho phép. |

Các regression về opaque session, cookie production, CSRF, token one-time/expiry và rate limit được thực hiện theo cùng matrix. Fixture và log assertion không được lưu raw cookie, password, CSRF, reset/verification token hoặc hash của chúng.

### Ma trận phái sinh không được trôi khỏi catalog

Ma trận visibility theo role trong `design/screen-inventory.md` và `design/information-architecture.md` là **phái sinh** của permission catalog ([authorization model](../security/authorization-model.md)); khi lệch, catalog thắng. Để chống trôi âm thầm: dùng lại fixture/cấu trúc của [authorization test matrix](../security/authorization-test-matrix.md), thêm assertion rằng **không affordance nào trong ma trận visibility cấp một action mà catalog Deny** cho role tương ứng (ví dụ Viewer không bao giờ có drag handle vì `task:move` Deny; Workspace Admin chưa là member luôn về Forbidden/404). E2E capability-affordance test hiện có là nơi thực thi; thay đổi permission chưa xong khi hai ma trận phái sinh chưa được re-check.

## Concurrency, transaction và retry

Integration test phải dùng PostgreSQL và transaction thực; mock repository không đủ để chứng minh atomicity.

| Case | Thiết lập | Expected result |
|---|---|---|
| Stale task update | Hai request đọc cùng version; request đầu commit trước, request sau gửi `expectedVersion` cũ. | Request sau là `409 TASK_VERSION_CONFLICT` với chỉ `currentVersion` an toàn; Task không bị overwrite và không có activity mới. |
| Task move transaction | Move tới active column cùng project với `expectedVersion` hợp lệ; kiểm tra column, ordering, version và activity trong một commit. | Task đổi `columnId`/`position`, version tăng đúng một, có đúng một `task.moved`; lỗi ở bất kỳ invariant nào rollback toàn bộ. |
| Cross-project move/assignment | Dùng destination column hoặc assignee từ Project A. | Reject trước commit; không có cross-project write hay activity. |
| Idempotent retry | Gửi lại cùng route, actor, canonical request fingerprint và `Idempotency-Key`. | Replay outcome đã lưu, không tạo duplicate task/comment/activity. Cùng key với fingerprint khác trả `409 IDEMPOTENCY_KEY_REUSED`. |
| Cursor scope | Dùng cursor của column/project/query khác. | `400 VALIDATION_FAILED`; không đọc sang scope khác. |
| Rebalance không tạo 409 giả | Chèn task liên tiếp vào cùng một khe cho tới khi vượt ngưỡng rebalance, trong khi một client khác đang giữ `version` của task không bị move. | Rebalance chỉ ghi `position`; `version` và `updated_at` của các row bị ghi lại không đổi, nên client kia không nhận `409` và seek pagination theo `updatedAt` không xáo. |
| Sprint active đồng thời (1.4) | Hai request activate hai sprint khác nhau cùng project, gửi đồng thời. | Đúng một commit; request còn lại thất bại ở partial unique index và trả `409 SPRINT_ALREADY_ACTIVE`. Không dùng advisory lock cho invariant này. |
| Dependency cycle đồng thời (1.5) | Chuỗi A→B→…→N, hai request đồng thời cùng đóng chu trình về A. | Advisory lock theo project tuần tự hoá; không request nào tạo được cycle, cái thua nhận `409 TASK_DEPENDENCY_CYCLE`. |

E2E thêm journey conflict: UI giữ local draft/snapshot, rollback optimistic move khi stale `409`, tải lại dữ liệu được phép đọc và không force/auto-merge/auto-retry stale write.

## Test đặt ở đâu

**Cạnh source khi test có đúng một chủ. Vào `src/test/` khi nó không có chủ nào.**

Đo trên cây hiện tại: 29 trong 30 test cạnh source có file chủ 1:1 cùng tên, cùng thư mục — `domain/ordering.ts` ↔ `domain/ordering.test.ts`, `lib/transport.ts` ↔ `lib/transport.test.ts`. Còn `src/test/` chứa đúng thứ không thuộc file nào: ma trận endpoint đối chiếu tài liệu, 207 khẳng định quyền trên mọi route, `accessibility`, `contrast`, `no-hardcoded-colors`, `responsive`, guard `web-routes`, cộng hạ tầng test (`fixture.ts`, `harness.tsx`).

Hậu tố `*.integration.test.ts` đánh dấu **"cần database"**, không đánh dấu "cross-cutting". Hai trục độc lập, và trộn chúng là chỗ dễ nhìn cấu trúc này thành tuỳ tiện: `shared/http/idempotency.integration.test.ts` nằm cạnh source vì nó có một chủ, dù nó cần Postgres.

Bốn lý do không gom hết vào `test/`:

1. **Test cạnh source chết cùng source.** Xoá `ordering.ts` là xoá luôn test của nó trong cùng một lần. Test ở thư mục khác để lại một file mồ côi, hoặc tệ hơn, một test còn xanh cho code đã biến mất.
2. **Import dài và dễ vỡ.** Repo này đã phải **bỏ** một lint rule chặn `../../../` vì nó bắt oan code đúng; thêm 30 đường như vậy là đi ngược.
3. **`test/` thành cây thư mục thứ hai soi gương `src/`, rồi lệch.** Đổi tên một module xong quên đổi bên kia là kiểu hỏng cổ điển.
4. **Mất tín hiệu "cái này đã có test".** Hiện `ls` một thư mục là biết; gom ra ngoài thì phải đi tìm.

Cách này cũng trùng convention của NestJS: generator đặt `*.spec.ts` cạnh file và `test/*.e2e-spec.ts` riêng.

Một ngoại lệ đã biết: `packages/contracts/src/contract-sync.test.ts` đọc Markdown nên là cross-cutting, nhưng package đó chỉ có hai test và không có `test/`. Tạo một thư mục cho một file là thêm cấu trúc không mua được gì; khi có test cross-cutting thứ hai thì dựng.

## Test ở đường nối giữa hai lane

Khi hai lane chạy song song, mỗi lane viết test theo hợp đồng **mà lane đó đọc**, và không ai sở hữu chỗ hai hợp đồng gặp nhau. Đó là hình dạng của loại lỗi tốn nhất trong repo này, vì nó lọt qua mọi cổng: cả hai bộ test đều xanh, và đều xanh **một cách đúng đắn**.

Ví dụ đã xảy ra ở M2. `apps/api` dựng link trong thư mời trỏ `/loi-moi`; `apps/web` dựng route `/loi-moi/chap-nhan`. Mọi người được mời nhận `404` — tức là tính năng không có đường vào nào — trong khi 543 test của backend và 242 test của frontend đều xanh. Lý do không bên nào bắt được: test backend đọc token **ra khỏi** Mailpit rồi tự gọi API, test frontend render component với `token` truyền vào và tự đặt `window.location`. Cả hai đều kiểm phần mình rất kỹ và không bên nào nhìn vào chính cái path trong thư.

Ba luật rút ra:

1. **Giá trị đi qua đường nối phải có một chỗ định nghĩa duy nhất**, và chỗ đó là `packages/contracts`. Path của link trong thư nay ở `WEB_ROUTES`; trước đó nó là hai chuỗi viết tay ở hai app.
2. **Guard phải đọc thực tại, không đọc một hằng số khác.** Test so hằng số với hằng số chỉ chứng minh hai chuỗi giống nhau. Guard cho `WEB_ROUTES` đọc `src/app` **trên đĩa** và khẳng định mỗi path có `page.tsx` — cùng lối `contract-sync.test.ts` đọc Markdown thay vì tin một bản sao trong code.
3. **Đường nối thuộc về người tích hợp, không thuộc lane nào.** Cả hai lane đều đúng theo phần mình; ai gộp hai lane lại là người phải viết test cho chỗ gặp nhau.

Danh sách đường nối hiện có, mỗi cái phải có guard đọc thực tại: hằng số ↔ Markdown (`contract-sync.test.ts`), error code ↔ danh mục trong tài liệu (hai chiều), status thành công ↔ hợp đồng endpoint (`endpoint-contract-matrix`), path trong thư ↔ route App Router (`web-routes.test.ts`), seed token của Ant Design ↔ variant mà component render (`theme.test.ts`).

## Khẳng định rỗng, và khi nào không thể làm nó đỏ

Một khẳng định **rỗng** là khẳng định đúng vì không có gì để kiểm. Nó tệ hơn một test còn thiếu, vì nó trông như bằng chứng. Repo này đã có hai lần:

- Trước khi `activity_logs` tồn tại, mọi khẳng định "deny không tạo activity row" đúng vì **không có bảng nào** để ghi vào. Backend ghi lại điều đó thay vì để nó trôi.
- Frontend gặp một test StrictMode xanh vì với `QueryClient` lạnh, lượt effect đầu thoát sớm ở `sessionLoading`, nên lượt thứ hai là lượt duy nhất thấy actor — test không hề kiểm cái nó nói.

Cách chữa mặc định là **phá luật, xem test đỏ, trả lại**. Nhưng có trường hợp cách đó không áp được, và nhận ra sớm quan trọng hơn là cố:

`authorization.integration.test.ts` khẳng định các nhánh deny không ghi activity. Không thể làm nó đỏ bằng cách cho một deny path ghi activity, vì deny ở đó là `403`/`404` từ **guard** — nó xảy ra **trước** use case, nên không có đường nào chạm tới recorder. Khẳng định đó không rỗng theo nghĩa sai; nó chỉ đang kiểm một điều được đảm bảo bởi kiến trúc chứ không bởi code của use case.

Khi gặp trường hợp đó, việc phải làm là **chứng minh kênh quan sát còn sống**: một test đối chứng cho thấy `snapshot().activity` *có* thay đổi khi một mutation được phép chạy. Không có nó, `toEqual(before)` vẫn là một khẳng định rỗng theo một kiểu khác — nó có thể đúng vì hàm `snapshot()` không đọc bảng đó nữa và không ai biết.

Nguyên tắc: **mỗi khẳng định phủ định phải đi kèm một quan sát dương tính chứng minh phép đo hoạt động.** Đây là điều mà một thí nghiệm thất bại thường làm ngầm; khi không thể phá luật, phải làm nó tường minh.

## Failure experiments và recovery checks

Failure experiment chỉ chạy trên local/CI hoặc environment non-production được cô lập. Nó có owner, thời hạn, dữ liệu disposable, expected signal và cleanup; không biến thành chaos testing production ngẫu hứng.

- PostgreSQL unavailable khi startup hoặc trong request: readiness trở thành không sẵn sàng, API trả error an toàn với `requestId`, không partial-commit mutation.
- Mailpit/SMTP local unavailable: flow email báo failure an toàn, không lộ token hoặc account existence và có log correlation để điều tra.
- Timeout/client retry: idempotent mutation không duplicate side effect.
- Migration fail hoặc restore drill fail: pipeline/deploy dừng; runbook được cập nhật trước lần thử tiếp theo.
- Khi Phase 1.2 tồn tại, worker restart, Redis unavailable, retry exhaustion và duplicate delivery là các experiment riêng cho job idempotency; chúng không thuộc MVP hiện tại.

## Quality gate và bằng chứng

Mỗi pull request phải chạy format, lint, typecheck, unit, integration, build, E2E và API contract checks theo [CI/CD](ci-cd.md). Thay đổi permission, session/CSRF, scope query, task move, idempotency, error envelope hoặc migration không được merge khi thiếu test phù hợp ở các lớp nêu trên.

Trước release, lưu artifact CI gồm kết quả test, OpenAPI lint/breaking-change result, image digest và migration review. Incident/recovery test lưu thời điểm, phạm vi, kết quả restore và hành động follow-up, không lưu secret hay production personal data trong test artifact.
