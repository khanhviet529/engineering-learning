# `@flowboard/e2e`

End-to-end qua trình duyệt, chạy trên **stack Compose thật**: `postgres`, `mailpit`, `api`, `web`.

## Chạy

```bash
# 1. Dựng stack (từ gốc lab)
docker compose -f infra/compose/compose.yaml --env-file .env up -d --build

# 2. Migration chạy tường minh, một lần cho database local đang chọn
DATABASE_URL="$DATABASE_URL_HOST" pnpm --filter @flowboard/api exec drizzle-kit migrate

# 3. Browser của Playwright (một lần cho mỗi máy)
pnpm --filter @flowboard/e2e exec playwright install chromium

# 4. Chạy
pnpm --filter @flowboard/e2e test
```

Địa chỉ mặc định trỏ tới cổng host đã publish trong Compose — `web` ở `3000`, `api` ở `3001`,
Mailpit ở `8026`, PostgreSQL ở `5433`. Ghi đè bằng `E2E_WEB_URL`, `E2E_API_URL`,
`E2E_MAILPIT_URL`, `E2E_POSTGRES_CONTAINER` khi topology khác.

`E2E_SIGN_UP_BUDGET` (mặc định `4`) phải đi **cùng cặp** với `RATE_LIMIT_OVERRIDES` của server.
Mặc định khớp bảng production — `auth.sign-up` là 5 lần mỗi phút mỗi IP — nên chạy cục bộ không cần
đặt gì. Job CI nới cả hai lên `200`; nới một phía thôi thì phía kia vẫn là nút thắt.

## Vì sao nó **không** nằm trong `pnpm verify`

`verify` phải chạy được trên một máy không có Docker. Một cổng đòi hạ tầng sẽ bị tắt ngay lần đầu
nó chặn ai đó, và một cổng bị tắt thì không bảo vệ gì. Vì vậy `pnpm test` ở gốc loại workspace này
ra (`--filter=!@flowboard/e2e`), còn `typecheck` và `lint` thì vẫn phủ nó — hai thứ đó không cần
stack nào.

Chỗ đúng của nó là một job CI riêng, sau `integration`. Xem mục đề xuất trong báo cáo M5.5.

## Nguyên tắc

- **Không seed.** Mọi tài khoản, workspace, dự án, cột và công việc đều được tạo **qua sản phẩm**.
  Một seed ghi thẳng database sẽ bỏ qua đúng đoạn đường đang được kiểm.
- **Không dọn dữ liệu.** Bộ này chạy nhiều lần trên cùng một stack đang sống, nên mọi định danh
  đều mang dấu thời gian và không trùng nhau. `src/db.ts` chỉ cho phép `SELECT`.
- **Không `waitForTimeout`.** Web-first assertion và `expect.poll`. Chờ một con số giây là chờ một
  thứ không ai đo được, và nó hỏng trên máy chậm hơn.
- **`retries: 0`.** Một bộ E2E hay đỏ rồi xanh ở lượt hai dạy người đọc rằng "chạy lại là được", và
  từ đó nó không còn là một cổng.
- **Chỉ `GET` được thử lại.** `visit` nạp lại một trang khi kết nối rớt, và Mailpit được đọc lại khi
  `ECONNRESET`. Không mutation nào được gửi lại: gửi lại một lệnh ghi mà không biết server đã nhận
  hay chưa là đúng thứ `Idempotency-Key` sinh ra để xử lý, và giấu nó sau một vòng lặp là bỏ mất
  chính thứ cần kiểm.
- **Đăng ký được giữ nhịp.** `POST /auth/sign-up` giới hạn 5 lần mỗi phút mỗi IP; bộ này cần khoảng
  mười tài khoản. `paceSignUp` mô phỏng đúng xô token đó và chờ **trước** khi gửi, thay vì bấm lại
  rồi tiêu thêm token.
- **Không có lệnh nào chặn vô hạn.** `src/db.ts` gọi `docker exec` bằng `execFileSync`, thứ chặn cả
  event loop của Node — một Docker daemon kẹt sẽ treo luôn đồng hồ của Playwright, và spec đứng im
  thay vì đỏ. Vì vậy lệnh đó có `timeout` và một câu ném đọc được.
- **Lối tắt phải có chú thích.** Chỗ nào không đi qua giao diện được thì hàm đó nói ra lý do ngay
  tại chỗ. Xem `lookupUserId` trong `specs/golden-path.spec.ts`.

## Bản đồ

| Tệp                             | Kiểm điều gì                                                              |
| ------------------------------- | ------------------------------------------------------------------------- |
| `specs/cors-preflight.spec.ts`  | Preflight cho phép mọi method mà client thật sự gửi                       |
| `specs/golden-path.spec.ts`     | Vòng đời Owner → Editor → Viewer, bảy chặng, qua giao diện                 |
| `specs/session-csrf.spec.ts`    | Thuộc tính cookie, vòng CSRF, mất phiên giữa chừng → `SYS-02`              |
| `specs/idempotency-replay.spec.ts` | Response bị nuốt rồi gửi lại cùng key; đếm hàng trong bảng             |
| `specs/two-tabs-conflict.spec.ts` | Hai phiên cùng ghi một task: `409` + `SYS-04`, không ghi đè              |
| `specs/dead-cursor.spec.ts`     | `MYT-01`: phạm vi đổi giữa chừng thì cursor chết và màn hình nói ra        |
| `specs/viewer-direct-http.spec.ts` | Viewer gọi thẳng HTTP: `403`; dự án ngoài phạm vi: `404` chứ không `403` |
| `specs/email-links.spec.ts`     | Ba loại thư được sinh ra trong lượt chạy; mọi liên kết trong chúng mở được |
