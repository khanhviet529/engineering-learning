# Frontend conventions Flowboard

Tài liệu này chuẩn hóa `apps/web` cho Next.js App Router, React và TypeScript. UI diễn đạt use case và trạng thái trong tài liệu UX/API; nó không tự mở rộng product scope, field, role hay authorization. Server luôn là quyết định quyền cuối cùng theo [authorization model](../security/authorization-model.md).

## Folder ownership trong Next.js

```text
apps/web/src/
├── app/                    # Route segment, layout, page, loading/error boundary composition
├── features/               # Product module: UI, query/mutation, form, local model của use case
├── components/
│   ├── ui/                 # Flowboard wrapper quanh Ant Design primitive
│   └── shared/             # Composition không mang task/project/auth behavior
├── hooks/                  # Hook browser generic có ít nhất hai consumer
├── lib/                    # Transport, QueryClient/setup, contract adapter và helper hẹp
├── styles/                 # Global reset, token bridge, typography; không chứa feature selector
└── test/                   # Fixture, render helper và test setup dùng chung
```

- `app/` chỉ compose route/layout, server-client boundary và route-level loading/error/not-found. Nó không chứa query key, form rule, business decision hoặc fetch ad-hoc.
- Mỗi `features/<name>/` sở hữu component, schema sử dụng, query key/factory, mutation, mapping response và test của use case đó. Ví dụ Task move, task form và task conflict ở Task feature; Project membership ở Project feature.
- `components/ui/` chứa wrapper Flowboard ổn định quanh primitive Ant Design đã được thiết kế; `components/shared/` chỉ chứa composition trình bày không biết API, resource hay permission. Một component cần Task/Project capability hoặc gọi mutation phải ở feature.
- `hooks/` và `lib/` chỉ nhận helper không có product rule sau [two-consumer](shared-helper-policy.md#quy-tắc-hai-consumer). Hook/query riêng cho feature ở lại feature đó.
- SCSS của feature đặt cạnh component bằng `*.module.scss`. `styles/` chỉ giữ global layer tối thiểu; không dùng global selector để vượt qua boundary của Ant Design hay feature khác.

## Trách nhiệm thư viện và component

| Công cụ | Dùng cho | Không dùng cho |
|---|---|---|
| Ant Design | Accessible base component, interaction primitive và theme token | Nguồn product behavior hoặc stylesheet global ghi đè tuỳ tiện |
| SCSS Modules | Layout/variant Flowboard cụ thể, scope class theo component | Token/utility dump toàn cục hoặc style cross-feature |
| TanStack Query | Server state, cache, loading/error, mutation/invalidation và optimistic update | Form draft, modal local state, role rule tự tính hoặc database cache |
| React Hook Form | Fixed form state, dirty/submitting state và input integration | Schema-driven builder hoặc dữ liệu server lâu dài |
| Zod | Parse/validate input theo contract trước khi gửi và typed form values | Thay thế validation/authorization phía API |
| dnd-kit | Pointer/keyboard DnD, accessible sensor và drag overlay của board | Quyết định vị trí cuối cùng hoặc bypass task-move API |

Flowboard bọc Ant Design trước khi dùng rộng rãi để giữ token, accessibility state, copy và variant nhất quán với Pencil. Wrapper không được tự fetch data, kiểm tra role hoặc gọi API.

## Server state, form và drag-and-drop

TanStack Query query key phải biểu đạt resource và input canonical, chẳng hạn project/task list có project scope, column/filter/sort/search/cursor hợp lệ. Cursor của một column không được dùng cho column khác. Sau mutation, feature cập nhật hoặc invalidate đúng projection bị ảnh hưởng; không clear toàn bộ cache như một cách che ownership chưa rõ.

Optimistic update chỉ dùng khi client có đủ response/capability để rollback chính xác. Task update/move luôn gửi `expectedVersion`; `409 TASK_VERSION_CONFLICT` hoàn nguyên optimistic state, hiển thị trạng thái conflict/reload-review và không ghi đè im lặng. DnD chỉ tạo command `destinationColumnId`, `targetPosition`, `expectedVersion` cho endpoint move; server trả task committed và là nguồn position/version mới.

### Vòng đời `Idempotency-Key` phía client

Server lưu outcome theo key ([idempotency contract](../api/api-conventions.md#idempotency-key)); phía client, quy tắc sinh/giữ/xoay key quyết định retry có phục hồi được hay không:

- Key được sinh cho **một ý định của user** (một lần bấm lưu, một cú thả DnD, một lần gửi comment) — không phải cho một HTTP attempt.
- **Giữ nguyên key** khi và chỉ khi gửi lại cùng payload y nguyên vì lỗi vận chuyển: network error, timeout, `5xx`. Đây là toàn bộ lý do key tồn tại — replay trả outcome đã lưu thay vì tạo hiệu ứng thứ hai.
- **Xoay key mới** khi: user sửa payload; sau khi giải quyết `409 TASK_VERSION_CONFLICT`/`WORK_LOG_VERSION_CONFLICT` và gửi lại với `expectedVersion` mới (bản gửi lại là một ý định mới trên version mới — giữ key cũ sẽ replay đúng outcome `409` đã lưu, hoặc bị `409 IDEMPOTENCY_KEY_REUSED` nếu payload đổi); user hủy rồi mở lại form.
- `409 IDEMPOTENCY_IN_PROGRESS`: cùng ý định, request gốc đang chạy — chờ theo `Retry-After` rồi gửi lại **cùng key**, không xoay.
- Không tự retry sau `429` hoặc `409` (API conventions đã cấm); nút thử lại do user bấm là một ý định mới nếu payload đã đổi, và vì vậy dùng key mới.
- `409 IDEMPOTENCY_KEY_REUSED` là **lỗi lập trình client** (tái dùng key cho payload khác), không phải trạng thái nghiệp vụ user gặp: log/report như bug qua `requestId`, hiển thị Error chung, không thiết kế nhánh UI riêng cho nó.

React Hook Form dùng schema Zod của form/use case có field allowlist. Client hiển thị lỗi field từ `VALIDATION_FAILED` khi `details` đã được server validate; lỗi không có field được hiển thị ở form/page scope. Disabled/hidden action dùng capability do server trả và `can(action, resource)` chung, nhưng mutation vẫn phải xử lý `403`, `404`, `409`, session hết hạn và network failure.

## Validation, error và chất lượng UI

- Không thêm field, filter, sort hay error code bằng suy đoán UI. Mapping request/response/error tuân theo [API conventions](../api/api-conventions.md) và [endpoint contracts](../api/endpoint-contracts.md).
- Loading, empty, network error, forbidden, validation, session expired và conflict phải là UI state rõ ràng theo UX contract. Message an toàn cho người dùng; không render raw stack, token, internal payload hay identifier của resource bị từ chối.
- Server-computed capabilities là input duy nhất cho affordance. Không encode Owner/Editor/Viewer condition trực tiếp trong page để thay cho `can`. `can(action, resource)` resolve theo thứ tự: `capabilities` per-record trên chính resource projection khi có (ví dụ WorkLog Phase 1.3, phụ thuộc status/date/author của từng record), nếu không thì capabilities mức project. Client không tự suy affordance per-record từ status/ngày/author — đó là duplicate policy bị [authorization model](../security/authorization-model.md#capabilities-for-the-frontend) cấm.
- Component kiểm tra accessibility semantic, keyboard flow và focus/announcement của form, drawer/modal và dnd-kit; dùng test id chỉ khi role/name không ổn định.

Vitest + Testing Library kiểm tra component/feature behavior: form validation, query state, capability affordance, optimistic rollback và error rendering. Playwright kiểm tra hành trình tích hợp Next.js + API: sign-in/session, board loading, Viewer bị từ chối mutation, User A/User B isolation, task conflict và keyboard/pointer drag flow. Chiến lược đầy đủ sẽ được operations documentation sở hữu; frontend phải giữ test gần feature thay vì đẩy logic vào E2E.

## Quyết định UI chưa dùng

Formily chưa thuộc core MVP. Nó chỉ phù hợp khi Flowboard thật sự có custom field do người dùng cấu hình hoặc schema-driven form builder, lúc đó cần quyết định về schema lifecycle, permission, validation và migration. Naive UI bị loại vì đây là thư viện Vue, còn Flowboard dùng React/Next.js.
