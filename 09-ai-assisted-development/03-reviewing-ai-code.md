---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-what-ai-changes.md
related:
  - 04-hallucination-verification.md
  - ../05-cross-cutting/testing/01-testing-pyramid-behavior.md
---

# Review code do AI sinh

> Một PR 800 dòng được review trong 12 phút và merge. Code sạch, đặt tên tốt, có comment, có test — test xanh. Ba tuần sau, một khách hàng thấy hoá đơn của khách hàng khác. Đoạn code lấy dữ liệu có `WHERE id = ?` nhưng thiếu `AND tenant_id = ?`. Reviewer đã đọc qua đoạn đó. **Nó trông đúng như mọi đoạn khác — và đó chính là vấn đề.**

## Position

```text
Code người viết:  lỗi thường đi kèm DẤU HIỆU
                  tên khó hiểu, cấu trúc lộn xộn, comment mâu thuẫn
                  → mắt reviewer được huấn luyện để bắt những dấu hiệu đó

Code AI viết:     lỗi KHÔNG có dấu hiệu bề mặt
                  đặt tên nhất quán, cấu trúc gọn, comment hợp lý
                  → toàn bộ tín hiệu bề mặt đều tốt, kể cả khi logic sai
```

## Problem

```text
Review truyền thống dựa nhiều vào TÍN HIỆU BỀ MẶT:
  code khó đọc → xem kỹ hơn
  tên mơ hồ → hỏi lại
  hàm dài 200 dòng → nghi ngờ

Với code AI sinh, những tín hiệu đó biến mất.
⇒ phải chuyển từ "quét tìm dấu hiệu" sang KIỂM TRA CÓ HỆ THỐNG.
⇒ và lượng code cần review tăng nhiều lần cùng lúc.
```

## Mental Model

### Ba loại lỗi, độ khó phát hiện tăng dần

```text
① SAI RÕ RÀNG          không biên dịch, không chạy, test đỏ
                       → dễ nhất; công cụ bắt được

② ĐÚNG NHƯNG SAI CHỖ   chạy đúng cho đầu vào thường
                       sai ở biên, khi đồng thời, hoặc ở quy mô
                       → cần đọc kỹ và biết hệ thống

③ ĐÚNG NHƯNG KHÔNG PHÙ HỢP  giải quyết đúng bài toán, sai cách với hệ thống này
                       lặp lại logic đã có · phá quy ước · thêm phụ thuộc thừa
                       → chỉ người biết codebase phát hiện được
```

```text
Công cụ tự động bắt ①.
Loại ② và ③ là lý do review vẫn cần người — và cần người BIẾT hệ thống.
```

### Chín thứ AI hay bỏ sót

```text
① QUYỀN TRUY CẬP      thiếu `tenant_id`/`owner_id` trong WHERE   ← sự cố ở đầu note
② ĐỒNG THỜI            read-modify-write, thiếu ràng buộc unique
③ NHIỀU INSTANCE       trạng thái in-memory, khoá in-memory, `@Cron` trên mọi pod
④ ĐƯỜNG LỖI            dependency chậm/chết; thiếu timeout
⑤ GIỚI HẠN             không phân trang, không giới hạn kích thước, `Promise.all` không giới hạn
⑥ TRƯỜNG HỢP BIÊN      rỗng, null, một phần tử, số âm, chuỗi rất dài, unicode
⑦ GIAO DỊCH            nhiều thao tác ghi không nằm trong transaction
⑧ TÀI NGUYÊN           kết nối/stream/listener không được đóng
⑨ QUY ƯỚC DỰ ÁN        cách xử lý lỗi, log, cấu trúc, thư viện đã có
```

```text
Chín mục này là danh sách kiểm tra — không phải để đọc, mà để CHẠY QUA
với từng PR. Chúng chiếm phần lớn lỗi loại ② và ③.
```

### Quy trình review sáu bước

```text
① CHẠY THỬ TRƯỚC KHI ĐỌC
   nó có chạy không? test có xanh không? có cảnh báo nào không?
   → đừng tốn thời gian đọc code không chạy

② ĐỌC TEST TRƯỚC
   test mô tả behavior gì? nó có phải behavior BẠN muốn không?
   test thiếu gì? (đường từ chối, đồng thời, biên)
   ⚠ test do AI sinh từ code sẽ KHÓA CHẶT hành vi hiện tại, kể cả khi sai

③ ĐỌC LUỒNG DỮ LIỆU, KHÔNG ĐỌC TỪNG DÒNG
   dữ liệu vào từ đâu → biến đổi thế nào → ghi đi đâu
   ở mỗi bước: có validate không? có phân quyền không? có giới hạn không?

④ CHẠY QUA CHÍN MỤC Ở TRÊN

⑤ KIỂM CHỨNG THỰC TẾ
   API này có tồn tại ở phiên bản đang dùng không?
   thư viện này đã có trong package.json chưa?
   → xem [Hallucination & verification](04-hallucination-verification.md)

⑥ CÂU HỎI CUỐI
   "3 giờ sáng đoạn này gây sự cố — tôi sửa được không?"
   Không → chưa merge được.
```

Bước ② đáng nhấn mạnh: **test là nơi review nên bắt đầu**, vì nó nói cho bạn biết tác giả nghĩ code nên làm gì — và khoảng cách giữa điều đó với điều bạn muốn là nơi bug sống.

### Test do AI sinh: cái bẫy ngược

```text
Nếu AI đọc CODE rồi sinh TEST:
  test khẳng định code làm ĐÚNG NHỮNG GÌ NÓ ĐANG LÀM
  → bug được test xác nhận là hành vi đúng
  → test xanh trở thành bằng chứng SAI

⇒ Thứ tự đúng: BẠN nêu behavior → AI viết test → AI (hoặc bạn) viết code
⇒ Kiểm tra: đọc tên test. Nó mô tả HÀNH VI HỆ THỐNG hay mô tả CODE?
     "tính đúng tổng khi có giảm giá VIP"    → behavior
     "gọi calculateDiscount với đúng tham số" → mô tả code, vô giá trị
```

### Kỹ thuật: bắt AI tự phản biện

```text
Sau khi nhận code, trước khi review:

  "Liệt kê 10 cách đoạn code này có thể sai trong production.
   Xét: đồng thời, nhiều instance, dữ liệu biên, dependency lỗi, quy mô lớn."

  "Đoạn code này giả định điều gì mà tôi chưa nêu?"

  "Nếu bạn phải tìm một bug trong đoạn này, bạn tìm ở đâu trước?"
```

```text
Nó không thay thế review, nhưng nó rẻ và thường tìm ra 2–3 điểm thật.
Đặc biệt hiệu quả cho mục ⑥ (trường hợp biên) trong danh sách chín mục.
```

### Đọc luồng dữ liệu thay vì đọc tuần tự

```text
Đọc từ dòng 1 tới dòng 800 là cách review kém hiệu quả nhất.

Thay vào đó, theo DỮ LIỆU:
  ① đầu vào đến từ đâu? (request body, query, header, message, DB)
     → nó được validate ở đâu? bằng schema chặt hay `any`?
  ② nó đi qua những biến đổi nào?
     → có chỗ nào mất thông tin, ép kiểu ngầm, hoặc giả định định dạng?
  ③ nó được ghi đi đâu?
     → có transaction không? có phân quyền không? có ràng buộc không?
  ④ cái gì trả về cho client?
     → có lộ trường không nên lộ không? có phân trang không?
```

Cách đọc này bắt được cả bốn mục đầu trong danh sách chín mục mà không cần đọc mọi dòng.

### Kích thước PR quan trọng hơn trước

```text
Khả năng review của người KHÔNG tăng theo tốc độ sinh code.

  PR 200 dòng  → review kỹ được
  PR 800 dòng  → review lướt, và bạn sẽ tự thuyết phục rằng đã đủ
  PR 2000 dòng → không review được, chỉ là nghi thức

⇒ Với AI, giới hạn kích thước PR quan trọng HƠN trước,
  vì viết 2000 dòng giờ mất 20 phút.
```

```text
Quy tắc thực dụng: nếu bạn không giải thích được PR cho người khác
trong 5 phút, nó quá lớn — chia nhỏ.
```

### Tự review code AI viết cho chính mình

```text
Trường hợp khó nhất: bạn "viết" code bằng AI và không có ai review.

Ba biện pháp:
  ① VIẾT LẠI BẰNG LỜI trước khi merge
     "đoạn này làm X bằng cách Y; nó hỏng khi Z"
     → không viết được = chưa hiểu
  ② TỰ TAY VIẾT TEST cho đường từ chối và đường biên
     → ép bạn nghĩ về behavior, không chỉ về code
  ③ ĐỂ NÓ QUA ĐÊM với PR không tầm thường
     → đọc lại sáng hôm sau bắt được nhiều thứ đáng ngạc nhiên
```

## Example

Một PR trông hoàn hảo, và bốn vấn đề trong đó:

```ts
// PR: "thêm endpoint xuất hoá đơn"
@Get('invoices/export')
async exportInvoices(@Query() query: ExportQuery, @CurrentUser() user: User) {
  const invoices = await this.repo.find({
    where: { createdAt: Between(query.from, query.to) },
    relations: { customer: true, lineItems: true },
  });

  const csv = invoices.map(inv =>
    `${inv.id},${inv.customer.name},${inv.total},${inv.createdAt}`
  ).join('\n');

  return { data: csv, count: invoices.length };
}
```

```text
Code sạch, đặt tên tốt, dễ đọc. Test (do AI sinh) xanh.
Bốn vấn đề, không cái nào có dấu hiệu bề mặt:

① QUYỀN TRUY CẬP — thiếu `tenantId: user.tenantId`
   → mọi người dùng xuất được hoá đơn của MỌI khách hàng
   ← đây chính là sự cố ở đầu note

② GIỚI HẠN — không phân trang, không giới hạn khoảng thời gian
   → `from=2020-01-01` tải 4 triệu dòng vào bộ nhớ → OOM

③ N+1 hoặc bộ nhớ — `relations` với 4 triệu dòng
   → hoặc một JOIN khổng lồ, hoặc 8 triệu truy vấn

④ CSV INJECTION — tên khách hàng bắt đầu bằng `=` được Excel diễn giải
   → và tên chứa dấu phẩy phá vỡ định dạng
```

```ts
// sau review
@Get('invoices/export')
async exportInvoices(@Query() query: ExportQuery, @CurrentUser() user: User) {
  // ② giới hạn khoảng thời gian, kiểm tra ở tầng schema
  if (differenceInDays(query.to, query.from) > 366) {
    throw new BadRequestException('khoảng thời gian tối đa 366 ngày');
  }

  // ① phân quyền TRONG query, không kiểm tra sau
  const scope = {
    tenantId: user.tenantId,
    ...(user.can('invoice:read:any') ? {} : { ownerId: user.id }),
    createdAt: Between(query.from, query.to),
  };

  // ② + ③ stream theo lô, không tải hết vào bộ nhớ
  const stream = new PassThrough();
  this.streamCsv(scope, stream).catch(err => stream.destroy(err));
  return new StreamableFile(stream, {
    type: 'text/csv',
    disposition: 'attachment; filename="invoices.csv"',
  });
}

private async streamCsv(scope: object, out: Writable) {
  out.write('id,customer,total,created_at\n');
  let cursor: string | undefined;

  for (;;) {
    const batch = await this.repo.find({
      where: { ...scope, ...(cursor ? { id: MoreThan(cursor) } : {}) },
      relations: { customer: true },
      order: { id: 'ASC' },
      take: 1000,                                     // ② lô cố định
    });
    if (batch.length === 0) break;

    for (const inv of batch) {
      out.write([inv.id, inv.customer.name, inv.total, inv.createdAt.toISOString()]
        .map(csvCell).join(',') + '\n');              // ④ escape
    }
    cursor = batch[batch.length - 1].id;
  }
  out.end();
}

// ④ chống CSV injection và dấu phẩy/nháy trong dữ liệu
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  const escaped = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;   // vô hiệu công thức
  return `"${escaped.replace(/"/g, '""')}"`;
}
```

Và test — do **người** định nghĩa behavior:

```ts
describe('GET /invoices/export', () => {
  it('không xuất hoá đơn của tenant khác', async () => {
    await seedInvoice({ tenantId: otherTenant.id });
    const { text } = await api.as(user).get('/invoices/export?from=...&to=...').expect(200);
    expect(text).not.toContain(otherTenantInvoiceId);       // ① đường TỪ CHỐI
  });

  it('từ chối khoảng thời gian quá 366 ngày', () =>
    api.as(user).get('/invoices/export?from=2020-01-01&to=2026-01-01').expect(400));

  it('không tải hết vào bộ nhớ với 50.000 hoá đơn', async () => {
    await seedInvoices(50_000, { tenantId: user.tenantId });
    const before = process.memoryUsage().heapUsed;
    await api.as(user).get('/invoices/export?from=...&to=...').expect(200);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(100 * 1024 * 1024);
  });

  it('escape tên khách hàng bắt đầu bằng dấu bằng', async () => {
    await seedInvoice({ tenantId: user.tenantId, customerName: '=1+1' });
    const { text } = await api.as(user).get('/invoices/export?from=...&to=...').expect(200);
    expect(text).toContain(`"'=1+1"`);                      // ④
  });
});
```

Bốn test này tương ứng với bốn vấn đề. Nếu AI sinh test từ code gốc, không test nào trong bốn cái này tồn tại — và cả bốn vấn đề đều được xác nhận là "hành vi đúng".

## Prediction

1. Code sạch, tên tốt, có comment, test xanh — nó có đúng không?
2. Reviewer quen bắt lỗi qua dấu hiệu bề mặt, đọc code AI — hiệu quả thế nào?
3. AI đọc code rồi sinh test, code có bug — test nói gì về bug đó?
4. Test tên `gọi calculateDiscount với đúng tham số` — nó kiểm chứng gì?
5. Test tên `tính đúng tổng khi có giảm giá VIP` — kiểm chứng gì?
6. PR 2000 dòng review trong 15 phút — review thật hay nghi thức?
7. Endpoint truy vấn thiếu `tenant_id`, test dùng một tenant — test có bắt được không?
8. Có test "người dùng tenant khác không thấy dữ liệu" — có bắt được không?
9. `relations` với 4 triệu dòng — chuyện gì xảy ra?
10. Tên khách hàng là `=1+1`, xuất CSV, mở bằng Excel — chuyện gì xảy ra?
11. Trạng thái lưu trong Map ở tầng module, chạy 1 pod trong dev — test có bắt được không?
12. Hỏi AI "liệt kê 10 cách đoạn này có thể sai" — chi phí và giá trị?
13. Đọc code từ dòng 1 tới 800 so với đọc theo luồng dữ liệu — cái nào bắt được nhiều hơn?
14. Bạn không giải thích được PR trong 5 phút — nên làm gì?

<details>
<summary>Đáp án</summary>

1. **Chưa biết** — tín hiệu bề mặt không nói gì về tính đúng đắn.
2. **Kém** — những dấu hiệu đó không còn xuất hiện.
3. Test **khẳng định bug là hành vi đúng**.
4. **Không gì có giá trị** — nó mô tả code, hỏng khi refactor.
5. Một **hành vi của hệ thống** — sống sót qua refactor.
6. **Nghi thức** — không ai review được 2000 dòng trong 15 phút.
7. **Không** — cần ít nhất hai tenant trong dữ liệu test.
8. **Có** — đây là lý do test đường từ chối quan trọng.
9. **OOM**, hoặc một JOIN khổng lồ làm nghẽn database.
10. Excel **diễn giải nó như công thức** — CSV injection.
11. **Không** — lỗi chỉ lộ ra khi có nhiều instance.
12. Rẻ, và thường tìm ra **2–3 điểm thật**.
13. **Theo luồng dữ liệu** — nó bắt được validate, phân quyền, giới hạn ở đúng chỗ.
14. **Chia nhỏ PR.**
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đọc tên mọi test trong PR | Bao nhiêu mô tả behavior, bao nhiêu mô tả code? |
| Tìm test cho đường TỪ CHỐI | Có không? |
| Chạy endpoint với tài khoản tenant khác | Có rò rỉ không? |
| Gọi endpoint danh sách không có tham số giới hạn | Trả về bao nhiêu? |
| Gửi chuỗi bắt đầu bằng `=` vào trường sẽ xuất CSV | Excel làm gì? |
| Chạy hai request đồng thời trên cùng bản ghi | Kết quả có đúng không? |
| Chạy service với 2 instance | Còn đúng không? |
| Ngắt dependency giữa chừng | Có timeout không? Có xử lý lỗi không? |
| Grep `Promise.all` không có giới hạn | Có mảng nào lớn không? |
| Hỏi AI "liệt kê 10 cách đoạn này sai" | Nó tìm ra gì? |
| Đo thời gian review trên số dòng | Có thật sự đọc hết không? |

## What Usually Goes Wrong

- **Tin tín hiệu bề mặt** — code sạch không nghĩa là code đúng.
- **Test do AI sinh từ code** → khoá chặt bug.
- **Không có test đường từ chối** → thiếu quyền truy cập không bị phát hiện.
- **Dữ liệu test chỉ một tenant/một người dùng** → lỗi phân quyền vô hình.
- **PR quá lớn** → review thành nghi thức.
- **Đọc tuần tự** thay vì theo luồng dữ liệu.
- **Bỏ qua đường lỗi** — chỉ review đường thành công.
- **Không kiểm tra hành vi với nhiều instance.**
- **Không kiểm chứng API và thư viện** có tồn tại và đã có sẵn không.
- **Merge vì test xanh** mà không đọc test.
- **Không ai giải thích được code** sau khi merge.
- **Không dùng AI để tự phản biện** — biện pháp rẻ nhất bị bỏ.
- **Review một mình code mình "viết" bằng AI** mà không có biện pháp bù.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Code sạch = code đúng | Tín hiệu bề mặt không nói gì về logic |
| Test xanh = behavior đúng | Test có thể do AI suy từ chính code đó |
| Review nhanh hơn vì code dễ đọc | Dễ đọc làm bạn tin nhầm là đã hiểu |
| Linter và type check là đủ | Chúng bắt loại ①, không bắt ② và ③ |
| AI ít mắc lỗi cú pháp nên ít lỗi | Lỗi của nó ở tầng logic và ngữ cảnh |
| PR lớn tiết kiệm thời gian review | Nó biến review thành nghi thức |
| Có thể review code mình tự viết bằng AI | Cần biện pháp bù, không thì mù như nhau |
| Comment trong code là bằng chứng hiểu | AI viết comment rất trôi chảy |
| Review là bước cuối cùng | Với AI, nó là nút thắt chính |
| Dùng AI review code AI là vô nghĩa | Nó rẻ và tìm ra được vài điểm thật |

## Debugging

Khi một bug lọt qua review:

1. **Nó thuộc loại nào** — ① ② hay ③? Loại ① nghĩa là công cụ tự động thiếu.
2. **Nó nằm trong chín mục không?** Nếu có, danh sách kiểm tra chưa được chạy qua.
3. **Test có thể bắt được không?** Nếu có, vì sao không có test đó — ai định nghĩa behavior?
4. **Dữ liệu test có đủ đa dạng không?** (nhiều tenant, nhiều người dùng, dữ liệu biên)
5. **PR lớn bao nhiêu?** Nếu trên 500 dòng, kích thước là một phần nguyên nhân.
6. **Thêm test cho chính bug đó** trước khi sửa.
7. **Nếu cùng loại lỗi lặp lại** → đưa nó vào file quy ước dự án để AI không sinh lại.
8. **Cập nhật danh sách kiểm tra review** — nó nên lớn lên theo kinh nghiệm của đội.

## Production Considerations

- **Giới hạn kích thước PR** — quan trọng hơn trước, vì viết code giờ rất nhanh.
- **Danh sách kiểm tra chín mục** chạy qua với mọi PR.
- **Đọc test trước, và đọc TÊN test** — chúng phải mô tả hành vi hệ thống.
- **Behavior do người định nghĩa**, AI viết test sau.
- **Dữ liệu test có nhiều tenant và nhiều người dùng** — điều kiện để bắt lỗi phân quyền.
- **Test đường từ chối bắt buộc** cho mọi endpoint.
- **Đọc theo luồng dữ liệu**, không đọc tuần tự.
- **Kiểm chứng API và thư viện** trước khi merge.
- **Dùng AI tự phản biện** trước khi review — rẻ và hiệu quả.
- **Không merge code không giải thích được.**
- **Lỗi lặp lại → đưa vào file quy ước dự án.**
- **Kiểm tra hành vi với nhiều instance** trong staging.
- **Cấu hình công cụ tự động chặt hơn**: `noUncheckedIndexedAccess`, lint rule chặn `any` và raw query.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Review kỹ mọi dòng | bắt được lỗi loại ② ③ | mất phần lớn thời gian tiết kiệm |
| Review lướt | nhanh | nợ hiểu biết, bug lọt |
| PR nhỏ | review được thật | nhiều PR hơn, nhiều overhead |
| PR lớn | ít overhead | review thành nghi thức |
| AI sinh test | phủ nhanh | có thể khoá chặt bug |
| Người định nghĩa behavior | test là hợp đồng thật | chậm hơn |
| Dùng AI tự phản biện | rẻ, tìm được vài điểm | không thay thế review người |
| Công cụ tự động chặt | bắt loại ① tự động | ma sát khi phát triển |
| Danh sách kiểm tra cố định | không bỏ sót | tốn thời gian mỗi PR |

## Explain Without Notes

1. Vì sao review code AI khác review code người viết?
2. Ba loại lỗi và loại nào công cụ tự động bắt được?
3. Chín thứ AI hay bỏ sót — kể được bao nhiêu?
4. Sáu bước review, và vì sao đọc test trước?
5. Vì sao test do AI sinh từ code là cái bẫy ngược?
6. Cách phân biệt test mô tả behavior với test mô tả code?
7. Vì sao đọc theo luồng dữ liệu hiệu quả hơn đọc tuần tự?
8. Vì sao giới hạn kích thước PR quan trọng hơn trước?

## Related

- [AI thay đổi cái gì](01-what-ai-changes.md) — review là nút thắt mới
- [Context engineering](02-context-engineering.md) — ngữ cảnh tốt giảm lỗi loại ③
- [Hallucination & verification](04-hallucination-verification.md) — bước ⑤ của quy trình
- [AI security & limits](05-ai-security-limits.md) — rủi ro bảo mật cần review riêng
- [Test theo behavior](../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — behavior là hợp đồng
- [Access control](../05-cross-cutting/security/04-access-control.md) — mục ① trong danh sách
- [Shared state & races](../05-cross-cutting/concurrency/02-shared-state-races.md) — mục ②
- [Concurrency models](../05-cross-cutting/concurrency/01-concurrency-models.md) — mục ③
- [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) — mục ④
- [Backpressure](../05-cross-cutting/performance/06-backpressure.md) — mục ⑤

## Version / Context

Ví dụ dùng NestJS 10/11, TypeORM, Node.js 20+ (`StreamableFile`, `PassThrough`). CSV injection (còn gọi là formula injection) là rủi ro khi dữ liệu người dùng được mở bằng phần mềm bảng tính; biện pháp escape ở đây theo khuyến nghị của OWASP. Nguyên tắc review không phụ thuộc công cụ AI cụ thể.
