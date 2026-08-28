---
level: intermediate
area: frontend
prerequisites:
  - 08-refs-uncontrolled.md
  - 04-server-state-cache.md
related:
  - ../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md
  - ../../03-nextjs/behavior/05-route-handlers-server-actions.md
---

# Forms

> Form là nơi ba thứ gặp nhau: state của UI, validation, và mutation. Phần lớn form khó bảo trì vì cả ba bị trộn lẫn trong một component.

## Position

```text
User input → form state → validation (client) → submit → API → validation (server) → DB
                                                                      ↑ nơi duy nhất tin được
```

## Problem

```tsx
// Form 8 field viết thủ công
const [name, setName] = useState('');
const [email, setEmail] = useState('');
// ... 6 field nữa
const [errors, setErrors] = useState<Record<string, string>>({});
const [submitting, setSubmitting] = useState(false);
const [touched, setTouched] = useState<Record<string, boolean>>({});
```

Vấn đề tích luỹ: mỗi ký tự gây render cả form; validation viết tay lệch với validation của server; không xử lý double-submit; lỗi từ server không map về field; reset khi đổi dữ liệu không hoạt động.

Và câu hỏi bị bỏ qua nhiều nhất: **validation ở client có ý nghĩa gì?** Nó là **UX**, không phải bảo mật. Người dùng có thể gửi request trực tiếp bằng `curl`. Client validation làm trải nghiệm tốt hơn; server validation làm hệ thống đúng.

## Mental Model

Bốn quyết định độc lập, và trộn chúng là nguồn của độ phức tạp:

```text
1. Ai giữ giá trị?           → uncontrolled (DOM) | controlled (state)
2. Validate khi nào?         → onChange | onBlur | onSubmit
3. Ai định nghĩa quy tắc?    → schema dùng CHUNG client+server
4. Ai là nguồn sự thật?      → SERVER, luôn luôn
```

Mặc định hợp lý cho phần lớn form:

```text
uncontrolled + validate onBlur + schema chung + server là sự thật
```

Vì sao `onBlur` chứ không `onChange`: validate khi đang gõ hiện lỗi "email không hợp lệ" ngay ở ký tự đầu tiên — người dùng chưa gõ xong đã bị mắng. `onBlur` (hoặc `onChange` **sau** lần blur đầu tiên) là hành vi ít gây khó chịu nhất.

## How It Works

### Schema dùng chung

Đây là quyết định có giá trị lớn nhất trong note này:

```ts
// shared/schemas/task.ts — dùng ở CẢ frontend và backend
import { z } from 'zod';

export const CreateTask = z.object({
  title: z.string().min(1, 'Bắt buộc').max(200),
  description: z.string().max(5000).optional(),
  dueDate: z.coerce.date().min(new Date(), 'Phải ở tương lai').optional(),
  assigneeId: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTask>;
```

Frontend dùng nó cho UX; backend dùng nó để bảo vệ. Một nguồn sự thật nghĩa là **không thể lệch nhau** — điều mà hai bản viết tay chắc chắn sẽ làm.

### React Hook Form + Zod

```tsx
function TaskForm({ onDone }: { onDone: () => void }) {
  const {
    register, handleSubmit, setError, reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTaskInput>({
    resolver: zodResolver(CreateTask),
    mode: 'onBlur',
  });

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(input),
    onSuccess: () => { reset(); onDone(); },
    onError: (e) => {
      // Map lỗi từ server về đúng field
      if (e instanceof ValidationError) {
        for (const [field, msg] of Object.entries(e.fields)) {
          setError(field as keyof CreateTaskInput, { message: msg });
        }
      } else {
        setError('root', { message: 'Không lưu được, thử lại sau' });
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => create.mutate(d))} noValidate>
      <label htmlFor="title">Tiêu đề</label>
      <input
        id="title"
        {...register('title')}
        aria-invalid={!!errors.title}
        aria-describedby={errors.title ? 'title-err' : undefined}
      />
      {errors.title && <p id="title-err" role="alert">{errors.title.message}</p>}

      <button type="submit" disabled={isSubmitting}>Lưu</button>
      {errors.root && <p role="alert">{errors.root.message}</p>}
    </form>
  );
}
```

Ba điểm dễ bỏ trong đoạn trên:

- **`setError` từ lỗi server** — không có nó, lỗi 400 từ backend hiện dưới dạng toast chung và người dùng không biết field nào sai.
- **`aria-invalid` + `aria-describedby` + `role="alert"`** — điều kiện để screen reader thông báo lỗi. Không phải tuỳ chọn.
- **`disabled={isSubmitting}`** — chống double-submit ở tầng UX (không phải đảm bảo; xem dưới).

### Accessibility — yêu cầu, không phải tối ưu

```tsx
<label htmlFor="email">Email</label>        {/* label liên kết bằng htmlFor/id */}
<input id="email" type="email" autoComplete="email" required
       aria-invalid={!!error} aria-describedby="email-err" />
<p id="email-err" role="alert">{error}</p>
```

- **`<label htmlFor>`** — placeholder **không** thay thế label (mất khi gõ, screen reader không đọc đáng tin).
- **`type`** đúng (`email`, `tel`, `number`, `url`) → bàn phím phù hợp trên mobile.
- **`autoComplete`** → autofill hoạt động; giá trị đúng theo chuẩn HTML.
- **`role="alert"`** → lỗi được đọc lên khi xuất hiện.
- **Focus vào field lỗi đầu tiên** khi submit thất bại.

### Server luôn phải validate lại

```ts
// Backend — không tin gì từ client
@Post()
async create(@Body() body: unknown) {
  const input = CreateTask.parse(body);      // ném 400 nếu sai
  return this.tasks.create(input);
}
```

Nếu bạn chỉ validate ở một nơi, phải là server. Xem [Validation & errors](../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md).

### Double-submit

Ba lớp, và chỉ lớp cuối là đảm bảo:

```text
1. disable nút khi isSubmitting        → chặn người dùng bình thường
2. mutation dedupe                     → chặn trong một tab
3. idempotency key / unique constraint → chặn MỌI trường hợp (2 tab, retry mạng, cố ý)
```

Xem [Idempotency & retry](../../../06-system-design/03-idempotency-retry.md).

### Reset khi dữ liệu đổi

```tsx
// ❌ effect để reset
useEffect(() => { reset(task); }, [task]);

// ✅ key — form mount lại với giá trị mới, mọi state tự sạch
<TaskForm key={task.id} defaultValues={task} />
```

Xem [Reconciliation & keys](05-reconciliation-keys.md).

## Example

```tsx
// Progressive enhancement với Server Actions — form hoạt động cả khi JS chưa tải
export default function Page() {
  return (
    <form action={createTask}>              {/* Server Action */}
      <input name="title" required />
      <SubmitButton />
    </form>
  );
}

// 'use client'
function SubmitButton() {
  const { pending } = useFormStatus();      // trạng thái của form cha
  return <button disabled={pending}>{pending ? 'Đang lưu...' : 'Lưu'}</button>;
}
```

Đây là điều form thuần HTML làm được mà SPA thường mất: nó hoạt động trước khi JavaScript tải xong. Xem [Route Handlers & Server Actions](../../03-nextjs/behavior/05-route-handlers-server-actions.md).

## Prediction

1. Form controlled 20 field, gõ một ký tự — bao nhiêu component render? Uncontrolled thì bao nhiêu?
2. Validate `mode: 'onChange'` cho email — người dùng thấy gì khi gõ ký tự thứ nhất?
3. Server trả 400 với `{ fields: { title: 'đã tồn tại' } }` nhưng bạn không gọi `setError` — người dùng thấy gì?
4. Chỉ có `disabled={isSubmitting}`, người dùng mở 2 tab và submit cùng lúc — bao nhiêu record?
5. `<input placeholder="Email" />` không có label — screen reader đọc gì khi field được focus lần thứ hai?
6. `useEffect(() => reset(task), [task])` với `task` là object mới mỗi render — điều gì xảy ra?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Form controlled 30 field, CPU throttle 4×, gõ nhanh | Lag rõ rệt |
| Cùng form uncontrolled (RHF) | Mượt |
| `mode: 'onChange'` cho email | Lỗi hiện ngay ký tự đầu — trải nghiệm tệ |
| Bỏ validation server, gửi payload sai bằng `curl` | Dữ liệu rác vào DB |
| Bỏ `setError` cho lỗi server | Người dùng không biết sửa field nào |
| Bỏ `<label>`, dùng screen reader (NVDA/VoiceOver) | Field không có tên |
| Submit 5 lần nhanh, không có unique constraint | 5 record |
| Bỏ `role="alert"` | Lỗi không được đọc lên |
| Viết validation client và server riêng, rồi đổi một bên | Chúng lệch nhau; client cho qua, server từ chối (hoặc ngược lại) |

## What Usually Goes Wrong

- **Chỉ validate ở client** → dữ liệu rác, lỗ hổng bảo mật.
- **Validation client và server viết riêng** → lệch nhau.
- **Không map lỗi server về field** → người dùng không biết sửa gì.
- **Controlled cho form lớn** → lag trên máy yếu.
- **Validate `onChange`** → mắng người dùng khi họ đang gõ.
- **Không có label** → không dùng được với screen reader; và thường cả với autofill.
- **Chỉ disable nút** cho double-submit.
- **Reset bằng effect** thay vì `key`.
- **Mất dữ liệu khi lỗi** — submit fail và form bị clear là cách nhanh nhất làm người dùng bỏ đi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Validation client là bảo mật | Là UX. Server mới bảo vệ |
| Controlled là "cách React" | Uncontrolled đúng React và nhanh hơn cho form |
| `placeholder` thay được `label` | Không — mất khi gõ, a11y kém |
| `required` của HTML là đủ | Dễ bỏ qua, thông báo không kiểm soát được. Dùng `noValidate` + validation của bạn |
| Disable nút chống được double-submit | Chỉ ở một tab, với người dùng bình thường |
| Lỗi server nào cũng hiện toast là ổn | Lỗi validation phải về đúng field |
| Form nhiều bước cần state global | Thường chỉ cần một state ở component cha của các bước |

## Debugging

1. **Render nhiều khi gõ** → Profiler; nếu mỗi ký tự render cả form thì đang controlled. Chuyển sang RHF.
2. **Validation lệch client/server** → kiểm tra có dùng chung schema không. Nếu không, đó là nguyên nhân.
3. **Lỗi server không hiện** → log response 400; kiểm tra hình dạng lỗi có khớp code map không.
4. **Form không reset** → dùng `key` thay vì effect.
5. **A11y** → Tab qua toàn bộ form chỉ bằng bàn phím; bật screen reader; chạy axe DevTools. Ba việc này bắt gần hết vấn đề.
6. **Dữ liệu rác trong DB** → kiểm tra server có validate không, và constraint ở DB có không. Xem [Constraints & invariants](../../../03-database/03-data-modeling/01-constraints-invariants.md).

## Production Considerations

- **Schema chung trong package/folder shared** — đây là quyết định kiến trúc, làm sớm.
- **Server validate mọi thứ**, kể cả field mà UI không cho sửa (người dùng có thể gửi chúng).
- **Constraint ở database** làm lớp cuối (unique, check, not null).
- **Giữ dữ liệu khi submit lỗi** — không bao giờ clear form khi thất bại.
- **Autosave draft** cho form dài (localStorage hoặc server) — mất dữ liệu vì đóng tab là vấn đề thật.
- **A11y là bắt buộc**: label, focus vào lỗi đầu tiên, `role="alert"`, thao tác được bằng bàn phím.
- **Rate limit endpoint submit** để chống abuse. Xem [Rate limiting](../../../02-backend-api/00-http-api/07-rate-limiting.md).

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Uncontrolled (RHF) | ít render, nhanh | validate live cần cấu hình thêm |
| Controlled | kiểm soát hoàn toàn, format live | render mỗi ký tự |
| Validate onSubmit | không quấy rầy | lỗi hiện muộn |
| Validate onBlur | cân bằng | vẫn có thể gây khó chịu ở field phức tạp |
| Validate onChange | phản hồi tức thì | mắng người dùng khi đang gõ |
| Schema chung | không lệch nhau | cần chia sẻ code giữa FE/BE |
| Server Actions | progressive enhancement | ràng buộc vào Next.js |

## Explain Without Notes

1. Validation ở client dùng để làm gì, và **không** dùng để làm gì?
2. Bốn quyết định độc lập khi thiết kế form?
3. Vì sao `onBlur` thường tốt hơn `onChange` cho validation?
4. Ba lớp chống double-submit, lớp nào là đảm bảo?
5. Bốn thuộc tính a11y bắt buộc cho một field có lỗi?

## Related

- [Refs & uncontrolled](08-refs-uncontrolled.md) — cơ chế của form uncontrolled
- [Server state & cache](04-server-state-cache.md) — mutation, `onError`
- [Reconciliation & keys](05-reconciliation-keys.md) — reset form bằng `key`
- [Validation & errors (NestJS)](../../../02-backend-api/02-nestjs/behavior/03-validation-errors.md) — phía server
- [Error model](../../../02-backend-api/00-http-api/05-error-model.md) — hình dạng lỗi để map về field
- [Route Handlers & Server Actions](../../03-nextjs/behavior/05-route-handlers-server-actions.md)
- [TypeScript ↔ runtime boundary](../../01-javascript-typescript/typescript/01-runtime-boundary.md) — vì sao cần validate
