---
level: advanced
area: backend
prerequisites:
  - 01-controller-service-repository.md
  - ../02-nestjs/02-modules-di.md
related:
  - ../../06-system-design/08-monolith-to-microservices.md
  - 03-domain-logic-boundaries.md
---

# Modular monolith

> Team 6 người, sản phẩm 8 tháng tuổi, một database. Ai đó đề xuất tách microservices "để scale". Câu hỏi đúng không phải "monolith hay microservices" mà là: *hiện tại bạn có biết module nào phụ thuộc module nào không?* Nếu không biết, tách ra chỉ biến những phụ thuộc vô hình đó thành những lời gọi mạng vô hình — và bây giờ chúng thất bại được.

## Position

```text
Một deployment · một database · một process
   ├── module: identity
   ├── module: projects
   ├── module: tasks
   ├── module: billing
   └── module: notifications
       ↑ ranh giới ở đây được ép bằng KỶ LUẬT + công cụ, không phải bằng mạng
```

Modular monolith nằm giữa hai thứ được nói tới nhiều nhất, và nó là đích thực tế của đa số dự án:

```text
Big ball of mud  ──▶  MODULAR MONOLITH  ──▶  Microservices
mọi thứ thấy mọi thứ   ranh giới rõ,          ranh giới ép bằng mạng,
                       cùng process           chi phí vận hành lớn
```

## Problem

### Layer không đủ

[Controller → Service → Repository](01-controller-service-repository.md) chia theo **loại việc**. Nhưng ba layer hoàn hảo vẫn cho phép:

```ts
// billing/invoice.service.ts
const task = await this.taskRepository.findById(id);          // ❌ chạm repository của module khác
const user = await this.prisma.user.findUnique({ where: { id } });  // ❌ chạm bảng của module khác
```

Layer nói "service không được viết SQL". Nó không nói "module billing không được đọc bảng của module tasks". Sau hai năm, mỗi module đọc bảng của mọi module, và bạn có một cấu trúc mà mọi thay đổi schema đều là thay đổi toàn cục.

Triệu chứng cụ thể, và chúng đo được:

```text
Đổi một cột trong bảng tasks → grep tên cột → 23 file thuộc 5 module
Xoá một tính năng            → không dám, vì không biết ai còn dùng
Onboarding người mới         → "cứ đọc hết đi, mọi thứ liên quan tới nhau"
Test một module              → phải seed dữ liệu của 5 module
```

### Nhưng microservices không phải câu trả lời mặc định

Tách service thay một lời gọi hàm (không bao giờ thất bại, 0.001ms) bằng một lời gọi mạng (thất bại được, 5–50ms, cần retry, timeout, circuit breaker, tracing). Bạn nhận lại: deploy độc lập, scale độc lập, cô lập lỗi.

Đó là một cuộc trao đổi hợp lý — **nếu** bạn thật sự cần cái nhận lại. Với một team 6 người deploy cùng lúc, bạn trả toàn bộ chi phí và nhận về gần như không có gì.

Và có một điều kiện tiên quyết mà hầu hết bài viết bỏ qua:

> Nếu bạn chưa vẽ được ranh giới trong một codebase, bạn sẽ không vẽ được nó khi chia thành nhiều codebase.

Tách nhầm ranh giới trong monolith = một buổi refactor. Tách nhầm ranh giới thành hai service = migration dữ liệu, hai deployment, và một API bạn không thể đổi.

## Mental Model

```text
MODULE = một NĂNG LỰC NGHIỆP VỤ, có:
   ├── public API      thứ duy nhất module khác được gọi
   ├── nội bộ          service, repository, entity — KHÔNG ai ngoài chạm tới
   ├── bảng riêng      module khác không SELECT trực tiếp
   └── phụ thuộc rõ    biết mình gọi ai, và không có vòng
```

Cách chia sai và cách chia đúng:

```text
❌ theo loại kỹ thuật              ✅ theo năng lực nghiệp vụ
   controllers/                       identity/       (đăng nhập, user, session)
   services/                          projects/       (project, thành viên)
   repositories/                      tasks/          (task, subtask, comment)
   entities/                          billing/        (gói, hoá đơn, thanh toán)
   dtos/                              notifications/  (email, push, in-app)

→ mọi thay đổi đụng 5 folder        → một tính năng nằm trong một folder
→ không folder nào có ranh giới     → mỗi folder có thể tách ra sau này
```

Bài kiểm tra: **thêm tính năng "task có nhãn" đụng bao nhiêu folder cấp cao nhất?** Với cách chia đúng: một.

## How It Works

### Public API của module

```text
src/modules/tasks/
├── index.ts                    ◀── CỬA DUY NHẤT: chỉ export những gì công khai
├── tasks.module.ts
├── api/                        thứ module khác được dùng
│   ├── tasks.facade.ts         interface cho module khác
│   └── task.dto.ts             kiểu dữ liệu chia sẻ (KHÔNG phải entity)
├── internal/                   không ai ngoài được import
│   ├── tasks.service.ts
│   ├── tasks.repository.ts
│   └── task.entity.ts
└── http/
    └── tasks.controller.ts
```

```ts
// tasks/index.ts — hợp đồng công khai, đọc file này là biết module cho ai dùng gì
export { TasksModule } from './tasks.module';
export { TasksFacade } from './api/tasks.facade';
export type { TaskSummaryDto } from './api/task.dto';
// KHÔNG export TasksService, TasksRepository, TaskEntity
```

```ts
// tasks/api/tasks.facade.ts — bề mặt hẹp, có chủ đích
@Injectable()
export class TasksFacade {
  constructor(private readonly tasks: TasksService) {}

  // trả DTO, KHÔNG trả entity — entity đổi được mà không phá module khác
  async summaryForProject(projectId: string): Promise<TaskSummaryDto> {
    const { open, closed } = await this.tasks.countByStatus(projectId);
    return { openCount: open, closedCount: closed };
  }
}
```

Điểm mấu chốt: **facade trả DTO, không trả entity.** Nếu `billing` nhận `TaskEntity`, thì mọi thay đổi trong `TaskEntity` là thay đổi phá vỡ `billing`. Trả DTO nghĩa là bạn có một hợp đồng hẹp và có thể tiến hoá phần bên trong tự do.

### Ép ranh giới bằng công cụ, không bằng lời hứa

Quy ước không được kiểm tra tự động sẽ bị vi phạm — không phải vì ai đó xấu tính, mà vì lúc 17:30 thứ Sáu, `import { TaskRepository }` là đường ngắn nhất.

```json
// .eslintrc — chặn import vào internal của module khác
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["**/modules/*/internal/*"], "message": "Dùng public API của module (index.ts)" },
        { "group": ["**/modules/*/http/*"],     "message": "Controller là chi tiết nội bộ" }
      ]
    }]
  }
}
```

```bash
# chặn vòng phụ thuộc — chạy trong CI
npx madge --circular --extensions ts src/
```

```ts
// test kiến trúc: giữ đồ thị phụ thuộc đúng như đã thiết kế
const ALLOWED: Record<string, string[]> = {
  identity:      [],
  projects:      ['identity'],
  tasks:         ['identity', 'projects'],
  billing:       ['identity'],
  notifications: ['identity'],          // nhận event, KHÔNG gọi ngược
};

it('không module nào phụ thuộc ngoài danh sách cho phép', () => {
  for (const [mod, allowed] of Object.entries(ALLOWED)) {
    expect(importedModulesOf(mod)).toEqual(expect.arrayContaining([]));
    expect(importedModulesOf(mod).filter((d) => !allowed.includes(d))).toEqual([]);
  }
});
```

Bảng `ALLOWED` là kiến trúc của bạn ở dạng có thể chạy được. Nó cũng buộc mỗi phụ thuộc mới phải là một quyết định có ý thức — ai đó phải sửa bảng này và giải thích trong PR.

### Đảo chiều phụ thuộc bằng event

Vấn đề: `tasks` cần gửi email khi task được giao. Gọi thẳng `notifications` tạo phụ thuộc, và nếu `notifications` cũng cần đọc task thì có vòng.

```ts
// tasks — phát sự kiện, KHÔNG biết ai nghe
this.events.emit('task.assigned', { taskId, assigneeId, projectId });
```

```ts
// notifications — lắng nghe, tasks không biết module này tồn tại
@OnEvent('task.assigned')
async onTaskAssigned(e: TaskAssignedEvent) {
  await this.mailer.send(e.assigneeId, 'Bạn được giao một task');
}
```

Cái được: `tasks` không còn biết `notifications` tồn tại. Thêm module `analytics` cũng nghe sự kiện đó không cần sửa `tasks` một dòng nào.

Cái mất — và phải nói rõ vì nó thường bị bỏ qua:

```text
✗ Không đọc code mà biết ai xử lý sự kiện này  → phải grep tên event
✗ Sự kiện in-process MẤT khi process crash     → không phù hợp cho việc quan trọng
✗ Lỗi trong handler không lan ngược về nơi phát → có thể im lặng thất bại
✗ Test khó hơn: khẳng định "email được gửi" phải qua một tầng gián tiếp
```

Với việc quan trọng (gửi hoá đơn, trừ tiền), event in-process **không đủ**. Ghi vào outbox trong cùng transaction rồi để worker xử lý. Xem [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md).

Quy tắc thực dụng: **event cho thứ có thể mất; lời gọi trực tiếp cho thứ không thể mất.**

### Dữ liệu: ranh giới khó nhất

Đây là chỗ modular monolith hay thất bại, vì một database làm cho việc vi phạm ranh giới trở nên **quá dễ**.

```text
Mức 1  Một schema, quy ước "không JOIN chéo module"
       + dễ nhất, không đổi hạ tầng
       - chỉ có code review giữ được; sẽ bị vi phạm

Mức 2  Schema riêng cho mỗi module, DB user riêng, GRANT theo schema
       + database TỪ CHỐI truy cập chéo — không phụ thuộc kỷ luật
       - JOIN chéo module không còn khả thi → phải thiết kế lại vài query
       - transaction vẫn xuyên schema được (cùng database)

Mức 3  Database riêng
       = đã là microservices về mặt dữ liệu; mất transaction xuyên module
```

**Mức 2 là điểm cân bằng tốt nhất** và bị đánh giá thấp. Nó cho bạn sự ép buộc thật (PostgreSQL trả `permission denied`, không phải reviewer trả comment) mà vẫn giữ được transaction xuyên module — thứ đắt nhất bạn mất khi đi microservices.

```sql
CREATE SCHEMA tasks;   CREATE SCHEMA billing;
CREATE USER billing_app;
GRANT USAGE ON SCHEMA billing TO billing_app;
-- không GRANT gì trên schema tasks → billing_app KHÔNG đọc được bảng tasks
```

Khi cần dữ liệu chéo module, thay JOIN bằng lời gọi facade — chậm hơn một chút, nhưng đó chính là chi phí mà bạn *muốn* thấy trước khi tách service.

### Khi nào tách thật sự

Tách một module ra service khi có **lý do cụ thể**, không phải khi thấy nó "đủ lớn":

```text
✓ Cần scale riêng   — báo cáo ăn CPU gấp 10 lần phần còn lại
✓ Cần cô lập lỗi    — thanh toán không được chết vì bug ở module khác
✓ Team riêng        — 3 team đụng nhau ở mỗi lần deploy
✓ Công nghệ khác    — ML cần Python
✓ Ràng buộc tuân thủ — dữ liệu y tế phải ở hạ tầng riêng

✗ "microservices là kiến trúc hiện đại"
✗ "monolith khó bảo trì"    → vấn đề là ranh giới, không phải số process
✗ "để scale"                → scale monolith bằng cách chạy nhiều instance rẻ hơn nhiều
```

Nếu module đã có ranh giới sạch (public API, schema riêng, không vòng), việc tách chủ yếu là hạ tầng: thay lời gọi facade bằng HTTP/gRPC client. Đó là phần thưởng thật của modular monolith — **nó giữ tuỳ chọn tách mà không bắt bạn trả trước.**

## Example

Đo ranh giới hiện tại của bạn bằng bốn lệnh, không cần đọc code:

```bash
# 1. Module nào import module nào?
npx madge --extensions ts --json src/modules | node analyze.js

# 2. Có vòng không?
npx madge --circular --extensions ts src/

# 3. Bao nhiêu chỗ chạm bảng của module khác?
grep -rn "prisma.task\." src/modules --include="*.ts" | grep -v "src/modules/tasks/"

# 4. Thêm một field vào entity đụng bao nhiêu module?
grep -rln "TaskEntity" src/modules | cut -d/ -f3 | sort -u
```

Kết quả của lệnh 3 và 4 là chỉ số sức khoẻ trực tiếp. Nếu lệnh 3 ra 20 dòng thuộc 4 module, bạn có một monolith chưa modular — và đó là thông tin quan trọng hơn bất kỳ sơ đồ kiến trúc nào.

## Prediction

1. `billing` import `TaskRepository` trực tiếp. Bạn đổi tên một cột trong bảng tasks — cái gì vỡ, và bạn biết trước hay biết lúc runtime?
2. Facade trả `TaskEntity` thay vì DTO. Bạn thêm field `internalNote` vào entity — nó xuất hiện ở đâu?
3. `tasks` gọi `notifications`, `notifications` gọi `tasks` để lấy tiêu đề — triệu chứng lúc khởi động NestJS?
4. Dùng event in-process, process crash ngay sau khi emit — email có được gửi không?
5. Mức 2 (schema + GRANT riêng), `billing` cố `SELECT` bảng tasks — lỗi ở đâu: compile, test, hay runtime?
6. Tách `notifications` thành service riêng. `tasks` gọi nó qua HTTP và HTTP call thất bại — task có được tạo không? Điều gì thay đổi so với lời gọi hàm?
7. Chia folder theo `controllers/ services/ repositories/`, thêm tính năng "nhãn cho task" — đụng bao nhiêu folder?
8. Có eslint rule chặn import internal nhưng không chạy trong CI — sau 3 tháng còn bao nhiêu vi phạm?

<details>
<summary>Đáp án</summary>

1. `billing` vỡ. Nếu dùng ORM có kiểu, bạn biết lúc compile — may mắn. Nếu raw SQL, biết lúc runtime, ở production.
2. Ở **mọi** response của mọi module dùng facade đó. Rò rỉ dữ liệu nội bộ do một thay đổi trông vô hại.
3. `Nest can't resolve dependencies`, hoặc phải dùng `forwardRef`. Vòng là tín hiệu ranh giới sai — sửa bằng event, không phải bằng `forwardRef`.
4. **Không.** Event in-process không có persistence.
5. **Runtime**, dưới dạng `permission denied for table tasks` — nhưng nó xảy ra ngay ở test tích hợp nếu bạn chạy với đúng DB user, và đó là điểm mạnh của mức 2.
6. Tuỳ bạn viết. Trước đây lời gọi hàm **không thể** thất bại; giờ nó thất bại được, và bạn phải quyết định: task vẫn tạo (event mất) hay cả use case fail. Đây chính là chi phí thật của việc tách.
7. Ít nhất 5 folder, và người review phải mở cả 5 mới hiểu tính năng.
8. Nhiều — quy ước không được kiểm tra tự động là quy ước bị vi phạm.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `grep` xem module nào chạm bảng module khác | Đếm số vi phạm hiện có |
| Thêm eslint rule chặn import internal | Bao nhiêu lỗi xuất hiện ngay lập tức? |
| Chạy `madge --circular` | Mỗi vòng là một ranh giới sai |
| Đổi tên một cột, chạy build | Bao nhiêu module vỡ? |
| Cho facade trả entity thay vì DTO, thêm field nhạy cảm | Nó lộ ra ở bao nhiêu endpoint? |
| Tạo vòng phụ thuộc giữa hai module | App start được không? |
| Sửa bằng event thay vì `forwardRef` | Vòng biến mất; nhưng giờ ai xử lý event? |
| Emit event rồi kill process ngay | Handler chạy không? |
| Bật schema + GRANT riêng, chạy test | Query chéo module fail ở đâu |
| Thử tách một module ra service | Liệt kê mọi chỗ phải đổi — đó là nợ ranh giới của bạn |

Dòng cuối là bài tập tư duy đáng làm mỗi quý, kể cả khi bạn không định tách: **số chỗ phải đổi chính là số đo ranh giới.**

## What Usually Goes Wrong

- **Chia folder theo loại kỹ thuật** → mọi tính năng đụng mọi folder.
- **Quy ước không được ép bằng công cụ** → bị vi phạm trong vài tuần.
- **Facade trả entity** → phần nội bộ trở thành API công khai một cách vô tình.
- **Truy cập chéo bảng** → đổi schema là thay đổi toàn cục.
- **Vòng phụ thuộc, sửa bằng `forwardRef`** → giấu vấn đề, nợ tích lại.
- **Lạm dụng event** → không ai lần được luồng thực thi; grep tên event là cách duy nhất.
- **Event cho việc quan trọng** → mất im lặng khi crash.
- **Tách microservices trước khi có ranh giới** → phụ thuộc phân tán, tệ hơn monolith.
- **Tách vì "hiện đại"** → trả chi phí vận hành mà không nhận lợi ích nào.
- **Module chia quá nhỏ** → 30 module cho 6 người, mọi thay đổi đụng nhiều module.
- **Một module `common/` khổng lồ** → nó trở thành nơi mọi thứ dồn vào, và mọi module phụ thuộc nó.

Dòng cuối đáng chú ý: `shared/` hoặc `common/` là nơi ranh giới đi chết. Nếu một thứ được dùng bởi hai module, hỏi *"nó thuộc năng lực nghiệp vụ nào?"* trước khi đẩy nó vào `common/`.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Monolith = big ball of mud | Cấu trúc bên trong và số deployment là hai chuyện khác nhau |
| Microservices giải quyết vấn đề bảo trì | Nó giải quyết vấn đề *tổ chức* và *scale*; ranh giới xấu vẫn xấu |
| Layer là đủ để có ranh giới | Layer chia theo loại việc, không theo năng lực |
| Module = folder | Module = folder **có public API được ép buộc** |
| Event luôn tốt hơn lời gọi trực tiếp | Event đánh đổi khả năng lần theo lấy sự tách rời |
| Event in-process đáng tin | Mất khi crash |
| Một database nghĩa là không thể modular | Schema + GRANT riêng cho ranh giới thật |
| Phải tách khi codebase lớn | Tách khi có lý do cụ thể về scale/lỗi/team |
| Modular monolith là bước đệm bắt buộc phải rời bỏ | Với nhiều sản phẩm, đó là đích cuối hợp lý |

## Debugging

Khi hỏi "kiến trúc của chúng ta có ổn không", đừng nhìn sơ đồ. Đo:

1. **Đồ thị phụ thuộc thật** (`madge`) so với đồ thị bạn *nghĩ* mình có. Khoảng cách giữa hai cái là vấn đề.
2. **Số vòng phụ thuộc.** Mục tiêu: 0.
3. **Số chỗ chạm bảng chéo module.** Mục tiêu: 0.
4. **Số module phải sửa cho một tính năng điển hình.** Mục tiêu: 1–2.
5. **Thời gian onboarding tới PR đầu tiên.** Nếu người mới phải hiểu cả hệ thống, ranh giới chưa làm việc.
6. **`git log` theo folder**: nếu mọi commit đụng cùng một tập folder, những folder đó thực chất là một module.

Chỉ số 6 là chỉ số trung thực nhất, vì nó đọc hành vi thật thay vì ý định.

## Production Considerations

- **Ranh giới đắt nhất để sửa sau là ranh giới dữ liệu.** Bắt đầu với schema riêng ngay cả khi chưa cần — chi phí ban đầu gần bằng 0, chi phí thêm vào sau rất lớn.
- **Kiểm tra kiến trúc trong CI** (eslint + madge + test đồ thị phụ thuộc) rẻ hơn code review, và không mệt mỏi.
- **Modular monolith scale ngang tốt.** Nhiều instance của cùng một app phía sau load balancer giải quyết phần lớn nhu cầu scale mà không cần tách service.
- **Ghi lại lý do mỗi phụ thuộc**, không chỉ danh sách. Sau một năm, "vì sao billing gọi tasks" quan trọng hơn "billing gọi tasks".
- **Nếu định tách, tách module ở rìa trước** (notifications, reporting) — chúng ít phụ thuộc và cho bạn học chi phí vận hành với rủi ro thấp.
- **Deploy vẫn là một đơn vị**, nên một bug ở module nào cũng có thể làm chết process. Nếu điều đó không chấp nhận được cho một năng lực cụ thể (thanh toán), đó là lý do chính đáng để tách *cái đó*, không phải tách tất cả.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Module theo năng lực nghiệp vụ | tính năng nằm một chỗ, tách được sau | phải quyết định ranh giới sớm |
| Module theo loại kỹ thuật | quen thuộc, dễ bắt đầu | không có ranh giới nào |
| Facade + DTO | nội bộ tự do tiến hoá | code map thêm |
| Chia sẻ entity | ít code | nội bộ thành API công khai |
| Event | tách rời, mở rộng dễ | khó lần theo, mất khi crash |
| Lời gọi trực tiếp | rõ ràng, có kiểu | tạo phụ thuộc cứng |
| Một schema | JOIN tự do, đơn giản | không ép được ranh giới |
| Schema riêng + GRANT | DB ép ranh giới, vẫn có transaction | phải bỏ JOIN chéo |
| Database riêng | độc lập hoàn toàn | mất transaction, cần đồng bộ |
| Monolith | deploy đơn giản, debug dễ | không cô lập lỗi, deploy chung |
| Microservices | deploy/scale/lỗi độc lập | mạng, tracing, dữ liệu phân tán, vận hành |

## Explain Without Notes

1. Vì sao layer không đủ để có ranh giới? Cho một ví dụ vi phạm mà layer không chặn được.
2. Module gồm những gì, ngoài "một folder"?
3. Vì sao facade phải trả DTO chứ không trả entity?
4. Event đảo chiều phụ thuộc thế nào, và bạn mất gì khi dùng nó?
5. Ba mức ranh giới dữ liệu, và vì sao mức 2 thường là điểm cân bằng tốt nhất?
6. Bốn con số bạn đo để biết ranh giới có thật hay không?
7. Ba lý do chính đáng để tách microservices, và ba lý do không chính đáng?

## Related

- [Controller → Service → Repository](01-controller-service-repository.md) — layer, và vì sao nó chưa đủ
- [Domain logic boundaries](03-domain-logic-boundaries.md) — ranh giới bên trong một module
- [Modules & DI](../02-nestjs/02-modules-di.md) — module graph của NestJS là kiến trúc thật
- [Monolith → microservices](../../06-system-design/08-monolith-to-microservices.md) — quyết định ở tầng hệ thống
- [Event-driven](../../06-system-design/07-event-driven.md) — event ở quy mô hệ thống phân tán
- [Outbox pattern](../../03-database/04-message-queues/06-outbox-pattern.md) — event không mất
- [Normalization](../../03-database/03-data-modeling/02-normalization.md) — ranh giới dữ liệu
- [Testing NestJS](../02-nestjs/09-testing-nestjs.md) — test kiến trúc trong CI
