---
level: intermediate
area: backend
prerequisites:
  - 02-modules-di.md
  - ../../../05-cross-cutting/testing/01-testing-pyramid-behavior.md
related:
  - ../../../05-cross-cutting/testing/05-testcontainers.md
  - ../../../05-cross-cutting/testing/06-deterministic-tests.md
  - 06-database-integration-transactions.md
---

# Testing NestJS

> Suite có 340 test, coverage 87%, tất cả xanh. Tuần trước production có ba sự cố: một endpoint trả dữ liệu của user khác, một migration làm mất cột, một transaction để lại dữ liệu nửa vời. Không test nào chạm tới bất kỳ chuyện nào trong ba chuyện đó — vì tất cả đều mock repository, và mock repository thì không có quyền, không có schema, không có transaction.

## Position

```text
E2E        HTTP thật → app thật → DB thật              chậm, ít, giá trị cao nhất
INTEGRATION service thật → repository thật → DB thật    ◀── vùng bị bỏ trống nhiều nhất
UNIT       hàm thuần / domain logic                     nhanh, nhiều, giá trị tuỳ nội dung
```

Trong một app NestJS, phần lớn logic đáng lo **không** nằm ở tầng unit. Nó nằm ở chỗ code gặp SQL, gặp transaction, gặp quyền, gặp lỗi constraint. Đó cũng là chỗ mock xoá sạch mọi thứ đáng test.

## Problem

### Vấn đề 1: mock nhiều tới mức test không còn chứng minh gì

```ts
const repo = { findOne: jest.fn().mockResolvedValue({ id: '1', ownerId: 'u1' }) };
const service = new TasksService(repo as any);

it('returns the task', async () => {
  expect(await service.findOne('1')).toEqual({ id: '1', ownerId: 'u1' });
});
```

Test này xanh. Nó chứng minh gì?

```text
✗ query có đúng cú pháp SQL không          — không, repo là mock
✗ điều kiện WHERE ownerId có tồn tại không — không, mock trả bất kể tham số
✗ index có được dùng không                  — không
✗ có N+1 không                              — không
✓ hàm gọi repo và trả kết quả về            — có, nhưng ai nghi ngờ điều đó?
```

Nó chứng minh rằng `service.findOne` gọi `repo.findOne`. Đó là chi tiết triển khai, không phải hành vi. Khi bạn refactor sang một query khác, test đỏ dù hành vi không đổi — nghĩa là test đang **cản trở** thay vì bảo vệ.

### Vấn đề 2: coverage đo sai thứ

Coverage đếm dòng được thực thi. Nó không phân biệt:

```ts
if (task.ownerId !== userId) throw new ForbiddenError();
```

Dòng này được "cover" bởi một test đi vào nhánh `false`. Nhánh `true` — nhánh **duy nhất có ý nghĩa bảo mật** — chưa bao giờ chạy. Coverage 100%, lỗ hổng vẫn nguyên.

Câu hỏi thay thế cho coverage: **"nếu tôi xoá dòng này, có test nào đỏ không?"** Với dòng phân quyền ở trên, câu trả lời trong hầu hết codebase là *không*.

## Mental Model

### Test theo cái nó bảo vệ, không theo tầng nó nằm

```text
Cái đáng bảo vệ                             Loại test rẻ nhất bảo vệ được nó
─────────────────────────────────────────   ─────────────────────────────────
Quy tắc nghiệp vụ thuần (tính giá, hợp lệ)  unit, không cần Nest
Điều kiện phân quyền                         integration/e2e với user KHÁC nhau
Query đúng (WHERE, JOIN, cột)                integration với DB thật
Tính nguyên tử của transaction               integration: ném lỗi giữa chừng
Map lỗi → status                             e2e
Hợp đồng API (shape, status)                 e2e
Chuỗi enhancer chạy đúng thứ tự              e2e
Wiring DI                                    khởi động app trong CI là đủ
```

Dòng cuối đáng chú ý: **bạn không cần test cho DI.** Lỗi DI làm app không start; một job CI chạy `NestFactory.create(AppModule)` bắt hết cả lớp lỗi đó với chi phí gần bằng không.

### Quy tắc mock

```text
MOCK  thứ bạn không sở hữu và chậm/tốn tiền/không xác định:
      payment gateway, email, S3, API bên thứ ba, đồng hồ, random

ĐỪNG MOCK  thứ mang ngữ nghĩa mà bạn đang muốn kiểm chứng:
      database, transaction, query, constraint
```

Diễn đạt khác: **mock ở ranh giới tiến trình, không mock ở ranh giới tầng.** Repository là ranh giới tầng, và mock nó nghĩa là bạn vừa mock đi đúng phần mình cần kiểm tra.

Lý do thực dụng khiến quy tắc này khả thi hơn 5 năm trước: với Testcontainers, một PostgreSQL thật khởi động trong ~2 giây và dùng chung cho cả suite. Cái giá đã giảm mạnh, nhưng thói quen mock thì chưa.

## How It Works

### `Test.createTestingModule` — ba mức

```ts
// 1. Chỉ một service, thay dependency bằng mock — cho logic thuần
const moduleRef = await Test.createTestingModule({ providers: [PricingService] })
  .useMocker((token) => (token === TaxService ? { rate: () => 0.1 } : undefined))
  .compile();
const pricing = moduleRef.get(PricingService);
```

```ts
// 2. Một module thật, chỉ thay thứ ở ngoài tiến trình — cho hành vi thật
const moduleRef = await Test.createTestingModule({ imports: [TasksModule, DbModule] })
  .overrideProvider(Mailer).useValue({ send: jest.fn() })       // ngoài tiến trình → mock
  .compile();
```

```ts
// 3. Cả app + HTTP thật — cho hợp đồng và chuỗi enhancer
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(Mailer).useValue({ send: jest.fn() })
  .compile();
const app = moduleRef.createNestApplication();
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));  // GIỐNG main.ts
await app.init();
```

Dòng `useGlobalPipes` trong mức 3 là chi tiết quyết định giá trị của e2e test: **`createNestApplication()` không tự áp dụng cấu hình trong `main.ts`.** Nếu bạn quên, test chạy trên một app *khác* với production — không có `whitelist`, không có filter, không có interceptor. Test xanh và production vẫn hở.

Cách sửa: rút phần cấu hình ra một hàm dùng chung.

```ts
// src/bootstrap.ts — main.ts và test cùng gọi
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();
  return app;
}
```

### Database thật với Testcontainers

```ts
// test/setup.ts — chạy MỘT lần cho cả suite
let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  execSync('npx prisma migrate deploy', { env: process.env });   // schema THẬT, từ migration THẬT
}, 60_000);

afterAll(() => container.stop());
```

Chạy migration thật (không phải `db push`, không phải `synchronize`) là điều đáng giá: nó biến "migration có chạy được không" thành một thứ CI kiểm tra mỗi lần, thay vì một thứ bạn phát hiện lúc deploy.

### Cô lập giữa các test: ba cách

```text
A. Transaction rollback mỗi test    nhanh nhất  · không test được transaction của app
B. TRUNCATE mọi bảng                nhanh       · phải liệt kê bảng, nhớ reset sequence
C. Database riêng mỗi worker        chậm nhất   · cô lập thật, chạy song song được
```

```ts
// B — thực dụng nhất cho hầu hết dự án
afterEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE;
  `);
});
```

Vì sao A hấp dẫn nhưng có bẫy: nếu test bọc mọi thứ trong một transaction rồi rollback, thì code của bạn **không thể** dùng transaction riêng của nó một cách bình thường — và test tính nguyên tử (thứ đáng test nhất) trở nên bất khả thi.

Với Jest chạy song song (`maxWorkers > 1`), B **không** đủ: hai worker dùng chung một database sẽ truncate dữ liệu của nhau. Hoặc chạy tuần tự cho nhóm test DB (`--runInBand`), hoặc dùng C với một schema PostgreSQL riêng mỗi worker:

```ts
const schema = `test_${process.env.JEST_WORKER_ID}`;
process.env.DATABASE_URL = `${baseUrl}?schema=${schema}`;
```

### Test phân quyền — theo hướng phủ định

Đây là nhóm test có tỉ lệ giá trị/chi phí cao nhất trong toàn bộ suite, và cũng là nhóm hay thiếu nhất.

```ts
describe('GET /tasks/:id', () => {
  it('owner đọc được', async () => {
    await request(app.getHttpServer())
      .get(`/tasks/${taskOfAlice.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
  });

  it('người khác KHÔNG đọc được', async () => {        // ◀── test thật sự bảo vệ bạn
    await request(app.getHttpServer())
      .get(`/tasks/${taskOfAlice.id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(404);                                     // 404, không phải 403 — không lộ sự tồn tại
  });

  it('không token → 401', async () => {
    await request(app.getHttpServer()).get(`/tasks/${taskOfAlice.id}`).expect(401);
  });
});
```

Và một test bao trùm, chống được cả lỗi bạn chưa nghĩ tới:

```ts
// mọi route không đánh dấu @Public() phải từ chối request không token
it.each(getAllRoutes(app).filter((r) => !r.isPublic))(
  '%s %s yêu cầu xác thực',
  async (method, path) => {
    const res = await request(app.getHttpServer())[method.toLowerCase()](path.replace(/:\w+/g, '1'));
    expect([401, 403]).toContain(res.status);
  },
);
```

Test này bắt được endpoint mới mà tác giả quên bảo vệ — đúng lớp lỗi mà code review hay bỏ sót. Nó đáng giá hơn 50 unit test cộng lại.

### Test tính nguyên tử của transaction

```ts
it('không ghi gì khi bước giữa thất bại', async () => {
  jest.spyOn(inventory, 'reserve').mockRejectedValueOnce(new Error('out of stock'));

  await expect(orders.checkout(userId, cart)).rejects.toThrow();

  expect(await prisma.order.count()).toBe(0);          // ← khẳng định thật sự quan trọng
  expect(await prisma.outboxEvent.count()).toBe(0);
});
```

Ba dòng cuối là thứ mock repository không bao giờ kiểm tra được. Nó cũng là test duy nhất phát hiện lỗi "một repository quên dùng `tx`" ở [Database & transactions](06-database-integration-transactions.md).

### Chống N+1 bằng test

```ts
it('list endpoint dùng số query cố định', async () => {
  await seedProjects(50);
  const queries: string[] = [];
  prisma.$on('query', (e) => queries.push(e.query));

  await request(app.getHttpServer()).get('/projects').expect(200);

  expect(queries.length).toBeLessThanOrEqual(3);       // KHÔNG tăng theo số project
});
```

Đây là cách hiếm hoi để bắt N+1 **trước** khi nó lên production, vì ở local nó không đủ chậm để ai để ý.

### Test enhancer

```ts
// guard: test qua HTTP, không test class trực tiếp
it('RolesGuard chặn member khỏi DELETE', () =>
  request(app.getHttpServer()).delete('/tasks/1').set(memberAuth).expect(403));

// interceptor: kiểm tra hiệu ứng quan sát được
it('bọc response trong { data }', async () => {
  const res = await request(app.getHttpServer()).get('/tasks').set(auth).expect(200);
  expect(res.body).toHaveProperty('data');
});

// filter: kiểm tra map lỗi
it('map ConflictError → 409', async () => {
  await createUser({ email: 'a@b.c' });
  const res = await request(app.getHttpServer()).post('/users').send({ email: 'a@b.c' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('conflict');
  expect(JSON.stringify(res.body)).not.toMatch(/constraint|users_email_key/);   // không lộ nội bộ
});
```

Nguyên tắc chung: **test enhancer qua HTTP, không gọi `guard.canActivate()` trực tiếp.** Gọi trực tiếp cần dựng một `ExecutionContext` giả, và cái giả đó thường không giống cái thật — bạn test được class nhưng không test được rằng nó *được gắn* vào đúng chỗ.

### Xác định: thời gian, ngẫu nhiên, thứ tự

Ba nguồn của test "lúc xanh lúc đỏ":

```ts
// thời gian — tiêm đồng hồ, đừng gọi new Date() trong domain
{ provide: 'CLOCK', useValue: { now: () => new Date('2026-01-15T10:00:00Z') } }
// hoặc: jest.useFakeTimers().setSystemTime(...)

// ngẫu nhiên — tiêm bộ sinh id
{ provide: 'ID_GEN', useValue: { next: () => 'fixed-id' } }

// thứ tự — SELECT không ORDER BY KHÔNG đảm bảo thứ tự
expect(result).toEqual(expect.arrayContaining([...]));   // thay vì toEqual mảng có thứ tự
```

Cái thứ ba đáng nhấn: PostgreSQL không hứa thứ tự khi thiếu `ORDER BY`, và nó thật sự trả về thứ tự khác nhau khi dữ liệu lớn lên hoặc plan thay đổi. Test dựa vào thứ tự ngẫu nhiên sẽ đỏ vào một ngày không liên quan gì tới thay đổi của bạn.

Test giòn (flaky) tệ hơn không có test: nó dạy cả team bấm "re-run" mà không đọc, và rồi một lỗi thật cũng bị re-run qua.

## Example

Một e2e test hoàn chỉnh, đo được giá trị của nó:

```ts
describe('POST /tasks', () => {
  it('tạo task và phát event, dữ liệu đúng trong DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ title: 'viết note', projectId: project.id })
      .expect(201);

    expect(res.body.data).toMatchObject({ title: 'viết note', status: 'open' });

    const row = await prisma.task.findUnique({ where: { id: res.body.data.id } });
    expect(row?.ownerId).toBe(alice.id);                 // server gán owner, KHÔNG lấy từ client
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('bỏ qua field client tự đặt', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks').set(aliceAuth)
      .send({ title: 'x', projectId: project.id, ownerId: bob.id })   // cố gán cho người khác
      .expect(400);                                                    // forbidNonWhitelisted
    expect(res.body.error.message).toContain('ownerId');
  });
});
```

Test thứ hai kiểm chứng chính xác lỗ hổng mass assignment ở [Validation & errors](03-validation-errors.md), qua toàn bộ chuỗi thật.

## Prediction

1. Mock repository trả cứng một task, rồi bạn xoá điều kiện `WHERE ownerId = ?` khỏi query — test có đỏ không?
2. Coverage 100% trên dòng `if (a !== b) throw` — nhánh ném lỗi chắc chắn đã được test chưa?
3. `createNestApplication()` không gọi `useGlobalPipes` — gửi field lạ vào endpoint có bị chặn không? Điều đó nói gì về giá trị của e2e suite?
4. Hai Jest worker cùng chạy test DB, cùng database, `TRUNCATE` sau mỗi test — chuyện gì xảy ra?
5. Test dùng transaction rollback để cô lập, và code của bạn cũng mở transaction — test tính nguyên tử có ý nghĩa không?
6. Test khẳng định `expect(rows).toEqual([a, b, c])` với query không `ORDER BY` — bao giờ nó đỏ?
7. Domain gọi `new Date()` trực tiếp, test khẳng định `expiresAt` — test chạy lúc 23:59:59.9 thì sao?
8. Test đếm số query để bắt N+1, seed 5 bản ghi thay vì 50 — test có bắt được N+1 không?
9. `overrideProvider(Mailer)` bị quên trong một e2e test — chuyện gì xảy ra khi chạy CI?
10. Chỉ có test "admin xoá được", không có test "member không xoá được" — lỗ hổng nào lọt qua?

<details>
<summary>Đáp án</summary>

1. **Không.** Mock trả cùng giá trị bất kể tham số. Bạn vừa xoá một kiểm tra bảo mật và suite vẫn xanh.
2. **Chưa.** Coverage dòng không phải coverage nhánh, và ngay cả branch coverage cũng không đảm bảo bạn khẳng định đúng thứ.
3. **Không bị chặn.** Test chạy trên một app khác production — mọi kết luận từ suite đó về hành vi biên đều không có giá trị.
4. Worker A truncate giữa lúc worker B đang chạy → đỏ ngẫu nhiên, không tái hiện được.
5. Gần như không. Transaction của app lồng trong transaction của test; rollback của app không quan sát được như ở production.
6. Vào một ngày ngẫu nhiên khi plan đổi (dữ liệu lớn hơn, index mới, seq scan thay index scan).
7. Đỏ ngẫu nhiên khi ngày đổi giữa lúc chạy — loại flaky khó chịu nhất vì nó hiếm.
8. Có thể không: với 5 bản ghi, 6 query vẫn dưới ngưỡng nếu ngưỡng đặt lỏng. Ngưỡng phải là hằng số **không phụ thuộc** số bản ghi, và seed phải đủ lớn để phân biệt.
9. Test gửi email thật (hoặc lỗi kết nối SMTP trong CI). Nếu SMTP thật hoạt động, bạn vừa spam người dùng thật từ CI.
10. Bất kỳ thay đổi nào nới quyền — xoá `@Roles`, sửa sai chuỗi role, đảo điều kiện — đều lọt.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá `WHERE ownerId = ?` khỏi một query, chạy suite | Đỏ hay xanh? Nếu xanh, suite không bảo vệ dữ liệu |
| Xoá `@Roles('admin')` khỏi một endpoint | Đỏ hay xanh? |
| Xoá `whitelist: true` khỏi cấu hình | Đỏ hay xanh? |
| Đổi `409` thành `500` trong filter | Đỏ hay xanh? |
| Bỏ `configureApp` khỏi e2e setup | Bao nhiêu test còn xanh dù app đã khác production? |
| Bỏ `overrideProvider(Mailer)` | CI gửi email thật? Hay lỗi kết nối? |
| Chạy suite DB với `maxWorkers=4` | Đếm số test đỏ ngẫu nhiên |
| Xoá `ORDER BY` khỏi một query, seed 10.000 dòng | Test thứ tự bắt đầu đỏ |
| Đổi giờ hệ thống sang 23:59:59 rồi chạy | Test nào phụ thuộc `new Date()` |
| Ném lỗi giữa transaction, đếm row | Có test nào bắt được không? |
| Seed 5 → 500 bản ghi cho test đếm query | N+1 lộ ra chưa? |
| Chạy `NestFactory.create(AppModule)` sau khi xoá một `exports` | Lỗi DI bị bắt ở đâu |

Bốn dòng đầu là bài kiểm tra chất lượng của suite, không phải của code. Nếu xoá một biện pháp bảo vệ mà suite vẫn xanh, suite đó không bảo vệ điều bạn tưởng.

## What Usually Goes Wrong

- **Mock repository** → test chứng minh mock hoạt động, không phải code hoạt động.
- **Không test nhánh phủ định của phân quyền** → lớp lỗ hổng nghiêm trọng nhất không được che.
- **E2E không dùng cấu hình của `main.ts`** → test một app không tồn tại.
- **Coverage thay cho suy nghĩ** → 90% coverage với 0% bảo vệ ở chỗ quan trọng.
- **Test song song chung DB** → đỏ ngẫu nhiên, và team học cách bấm re-run.
- **Test phụ thuộc thứ tự chạy** (test 2 dựa vào dữ liệu test 1 tạo) → đỏ khi đổi thứ tự hoặc chạy một test lẻ.
- **`new Date()` / `Math.random()` trong domain** → flaky theo thời gian.
- **Test dựa vào thứ tự không có `ORDER BY`** → đỏ vào ngày không liên quan.
- **Không test transaction** → dữ liệu nửa vời lên production.
- **Không có test đếm query** → N+1 lộ ở production.
- **Không chạy migration thật trong test** → migration hỏng chỉ lộ lúc deploy.
- **Mock `ConfigService` với giá trị khác production** → test xanh, cấu hình sai.
- **Test quá chi tiết vào implementation** (`expect(repo.findOne).toHaveBeenCalledWith(...)`) → cản trở refactor.
- **Suite chậm tới mức không ai chạy local** → phản hồi chỉ có ở CI, chu kỳ sửa lỗi dài gấp mười.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Coverage cao = an toàn | Coverage đo dòng chạy, không đo khẳng định đúng |
| Unit test là loại quan trọng nhất | Trong app CRUD, integration bảo vệ nhiều hơn |
| Mock làm test nhanh và sạch | Nó cũng xoá đúng thứ bạn cần kiểm tra |
| DB thật trong test là chậm và phiền | Testcontainers: ~2s một lần cho cả suite |
| E2E test là app thật | Chỉ khi bạn áp dụng đúng cấu hình của `main.ts` |
| Test giòn thì re-run là được | Nó huấn luyện cả team bỏ qua tín hiệu đỏ |
| Test happy path là đủ | Nhánh phủ định mới là nhánh bảo vệ bạn |
| Cần test cho wiring DI | Khởi động app trong CI là đủ |
| Nên test guard bằng cách gọi `canActivate()` | Nó không kiểm tra guard **được gắn** đúng chỗ |
| Test nhiều thì tốt | Test sai chỗ tạo chi phí bảo trì mà không tạo bảo vệ |

## Debugging

1. **Test đỏ ngẫu nhiên** → chạy `--runInBand`. Hết đỏ = vấn đề cô lập/song song. Còn đỏ = thời gian, ngẫu nhiên, hoặc thứ tự.
2. **Xanh local, đỏ CI** → so sánh biến môi trường và múi giờ (`TZ`). CI thường là UTC, máy bạn thì không.
3. **Test chậm** → đo từng `beforeEach`. Thường là dựng lại app hoặc container cho mỗi test thay vì mỗi suite.
4. **Không rõ test có giá trị không** → mutation testing thủ công: đảo một điều kiện, xem có đỏ không.
5. **E2E xanh nhưng production vỡ** → so sánh `main.ts` với setup của test, dòng một dòng.
6. **Không rõ query nào chạy** → bật `log: ['query']` trong test và in ra.
7. **Lỗi rò rỉ giữa test** → in số row của các bảng chính ở `beforeEach`. Khác 0 = cleanup không chạy.
8. **Test treo** → thường là app không được `close()` trong `afterAll`, hoặc timer/worker chưa dọn.

## Production Considerations

- **CI phải chạy migration thật lên một DB trống** rồi mới chạy test. Điều này biến "migration có chạy được không" thành một kiểm tra tự động.
- **Một smoke test khởi động app** (`NestFactory.create(AppModule)` rồi `close()`) bắt toàn bộ lớp lỗi DI và validate env, trong vài giây.
- **Tách suite theo tốc độ**: `test:unit` chạy mỗi lần lưu file; `test:integration` chạy trước khi push; `test:e2e` chạy trên CI. Nếu tất cả trong một lệnh 8 phút, không ai chạy nó.
- **Test smoke sau deploy** trên môi trường thật (health, một endpoint đọc, một endpoint ghi vào dữ liệu test) — nó bắt được vấn đề cấu hình mà không test nào ở CI bắt được.
- **Test dữ liệu thật quy mô nhỏ vẫn khác dữ liệu thật quy mô lớn.** Test không thay được đo đạc ở production.
- **Test bảo mật theo nhóm**: mỗi tài nguyên có ít nhất ba test — chủ sở hữu được, người khác không được, không token không được. Viết một helper để bộ ba này rẻ tới mức không có lý do bỏ qua.
- **Giữ thời gian suite dưới 5 phút.** Trên ngưỡng đó, người ta bắt đầu skip, và một suite bị skip là một suite không tồn tại.
- **Đặt ngưỡng số query** cho các endpoint list quan trọng. Đây là cách duy nhất N+1 không quay lại sau mỗi lần refactor.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Mock repository | test nhanh, không cần DB | không kiểm tra query, quyền, transaction |
| DB thật (Testcontainers) | kiểm tra được thứ quan trọng | chậm hơn, cần Docker trong CI |
| Nhiều unit test | phản hồi tức thì | có thể bảo vệ chỗ ít rủi ro nhất |
| Nhiều e2e test | gần production nhất | chậm, khó chỉ ra nguyên nhân khi đỏ |
| Cô lập bằng TRUNCATE | đơn giản | phải liệt kê bảng, không chạy song song được |
| Cô lập bằng schema mỗi worker | song song được | setup phức tạp hơn |
| Cô lập bằng transaction rollback | nhanh nhất | không test được transaction của app |
| Tiêm đồng hồ/ID | xác định | thêm một tầng trừu tượng |
| Test đếm query | chống N+1 | giòn khi query đổi hợp lệ |
| Coverage threshold trong CI | ép viết test | khuyến khích test rỗng để lấp số |

Dòng cuối đáng cảnh giác: ngưỡng coverage tạo áp lực viết test dễ nhất chứ không phải test giá trị nhất. Nếu dùng, dùng như tín hiệu để hỏi, không như cổng chặn.

## Explain Without Notes

1. Vì sao mock repository làm test mất giá trị? Cho một ví dụ lỗi mà nó không bao giờ bắt được.
2. Quy tắc "mock ở ranh giới tiến trình, không mock ở ranh giới tầng" nghĩa là gì?
3. Vì sao coverage 100% không chứng minh nhánh phân quyền được test?
4. Vì sao e2e test có thể xanh trên một app khác với production, và cách phòng?
5. Kể ba nguồn của test giòn và cách xử lý từng cái.
6. Test nào bắt được "một repository quên dùng `tx`"? Vì sao unit test không bắt được?
7. Câu hỏi nào tốt hơn "coverage bao nhiêu phần trăm"?

## Related

- [Testing pyramid & behavior](../../../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — khung chung
- [Mocking & test doubles](../../../05-cross-cutting/testing/04-mocking-test-doubles.md) — mock cái gì, không mock cái gì
- [Testcontainers](../../../05-cross-cutting/testing/05-testcontainers.md) — DB thật trong test
- [Deterministic tests](../../../05-cross-cutting/testing/06-deterministic-tests.md) — chống flaky
- [Modules & DI](02-modules-di.md) — `Test.createTestingModule`, override provider
- [Database & transactions](06-database-integration-transactions.md) — test tính nguyên tử, N+1
- [Guards & interceptors](04-guards-interceptors.md) — test phân quyền theo hướng phủ định
- [Validation & errors](03-validation-errors.md) — test biên và map lỗi
- [CI/CD pipeline](../../../04-infrastructure/03-cicd/01-pipeline.md) — nơi suite này chạy

## Version / Context

NestJS 10/11, Jest 29, `supertest` 7, `@testcontainers/postgresql` 10. Vitest dùng được thay Jest với thay đổi nhỏ ở API mock.
