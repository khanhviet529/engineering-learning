---
level: foundation
area: frontend
prerequisites:
  - 00-web-vocabulary.md
  - 01-browser-request-render.md
related:
  - ../03-nextjs/behavior/03-data-fetching-cache.md
  - ../../03-database/02-redis/01-cache-invalidation.md
---

# HTTP & browser cache

> Lớp cache đầu tiên giữa người dùng và dữ liệu của bạn — và là lớp bạn kiểm soát ít nhất, vì nó nằm trên máy người khác.

> **Chưa biết những từ này?** [Từ vựng Web](00-web-vocabulary.md) — header, status code, `304`

## Position

```text
Browser cache  ← ở đây
   ↓ (nếu miss)
CDN cache
   ↓ (nếu miss)
Next.js cache
   ↓ (nếu miss)
API → Redis → PostgreSQL
```

Bốn lớp. Khi "dữ liệu hiển thị sai", câu hỏi đúng không phải "cache có sai không" mà **"cache nào đang sai"**.

## Problem

Bạn sửa một file JS, deploy, và người dùng vẫn chạy code cũ. Bạn sửa dữ liệu, và một số người thấy mới, một số thấy cũ.

Ngược lại: bạn tắt hết cache cho an toàn, và server nhận gấp 20 lần request, hoá đơn CDN tăng, mọi trang chậm hơn.

Cache là bài toán đánh đổi **độ mới** với **chi phí**. Không có mặc định đúng — chỉ có quyết định đúng cho từng loại tài nguyên.

## Mental Model

Browser trả lời hai câu hỏi khác nhau, và trộn lẫn chúng là nguồn của gần như mọi nhầm lẫn về cache:

```text
Câu 1: "Có cần hỏi server không?"        → freshness  (Cache-Control, Expires)
Câu 2: "Bản tôi có còn đúng không?"      → validation (ETag, Last-Modified)
```

Ba trạng thái của một response trong cache:

| Trạng thái | Điều gì xảy ra | Trong DevTools |
|---|---|---|
| **Fresh** | Dùng ngay, **không có request nào đi ra** | `(from disk cache)` / `(memory cache)` |
| **Stale, có validator** | Gửi conditional request → `304 Not Modified` → dùng bản cũ | `304`, size nhỏ |
| **Stale, không validator** | Gửi request đầy đủ → `200` | `200`, size đầy đủ |

Điểm quan trọng: **`304` vẫn là một round-trip.** Nó tiết kiệm băng thông, không tiết kiệm độ trễ. Chỉ trạng thái *fresh* mới tiết kiệm cả hai.

## How It Works

### Cache-Control

```http
Cache-Control: max-age=31536000, immutable      # tài sản có hash trong tên
Cache-Control: no-cache                          # được cache, PHẢI validate mỗi lần
Cache-Control: no-store                          # không được lưu ở đâu cả
Cache-Control: private, max-age=0, must-revalidate  # HTML của trang có auth
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
```

Directive dễ nhầm nhất:

| Directive | Nghĩa thật |
|---|---|
| `no-cache` | **Được** lưu, nhưng phải validate trước khi dùng. Không phải "không cache" |
| `no-store` | Thật sự không lưu. Đây mới là cái bạn muốn cho dữ liệu nhạy cảm |
| `private` | Chỉ browser được cache, CDN/proxy chung **không** được |
| `public` | Cache chung được lưu, kể cả khi có `Authorization` header |
| `max-age` | Cho browser (giây) |
| `s-maxage` | Cho shared cache (CDN), ghi đè `max-age` |
| `immutable` | Đừng validate lại, kể cả khi người dùng bấm reload |
| `stale-while-revalidate=N` | Trả bản cũ ngay, refresh nền trong N giây |

`private` vs `public` là một quyết định **bảo mật**, không phải hiệu năng. Đặt `public` cho response chứa dữ liệu người dùng nghĩa là CDN có thể trả dữ liệu của người A cho người B.

### Validation

```http
# Response lần đầu
ETag: "a1b2c3"
Last-Modified: Wed, 27 Aug 2026 10:00:00 GMT

# Request lần sau
If-None-Match: "a1b2c3"
If-Modified-Since: Wed, 27 Aug 2026 10:00:00 GMT

# Server trả về nếu không đổi
HTTP/1.1 304 Not Modified     (không có body)
```

`ETag` chính xác hơn `Last-Modified` (vốn chỉ có độ phân giải giây và phụ thuộc mtime của file).

### Hai chiến lược, dùng cho hai loại tài nguyên

Đây là mấu chốt thực tế:

```text
Tài nguyên có hash trong tên (/app.a1b2c3.js)
  → Cache-Control: public, max-age=31536000, immutable
  → Đổi nội dung = đổi URL. Không bao giờ cần invalidate.

Tài nguyên có URL cố định (/index.html, /api/tasks)
  → Cache-Control: no-cache  (hoặc max-age ngắn)
  → Luôn validate; ETag làm cho việc validate rẻ.
```

Đây là lý do bundler đặt hash vào tên file. Nó biến bài toán "invalidate cache" — vốn khó — thành bài toán "đổi tên" — vốn dễ.

## Example

```ts
// Route handler: HTML/JSON có auth → không được cache chung
export async function GET() {
  const tasks = await getTasksForUser();
  return Response.json(tasks, {
    headers: {
      'Cache-Control': 'private, no-cache',
      ETag: `"${hashOf(tasks)}"`,
    },
  });
}
```

```ts
// Dữ liệu công khai, chấp nhận cũ 60s, và cũ thêm 5 phút khi đang refresh
headers: {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
}
```

## Prediction

1. Với `Cache-Control: no-cache`, browser có gửi request lần thứ hai không? Có nhận `200` hay `304`?
2. Với `max-age=3600`, bạn deploy phiên bản mới sau 10 phút. Người dùng đã tải trang thấy gì?
3. Response có `Cache-Control: public, max-age=600` nhưng body chứa email người dùng, đi qua CDN. Điều gì có thể xảy ra?
4. Bấm F5 vs Ctrl+Shift+R — request header khác nhau thế nào?
5. `ETag` đúng nhưng bạn thấy `200` chứ không phải `304`. Nêu hai nguyên nhân.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đặt `max-age=31536000` cho `/index.html` rồi deploy | Người dùng bị kẹt ở bản cũ một năm — không cách nào sửa từ server |
| Đặt `public` cho response có dữ liệu user, qua CDN chung | Dữ liệu người này lộ sang người khác (thử với 2 tài khoản) |
| Xoá `ETag`, giữ `no-cache` | Mọi request tải lại full body dù không đổi |
| DevTools → Disable cache, so sánh Network | Thấy rõ bao nhiêu request thật sự bị cache |
| Trả `ETag` mới mỗi lần dù nội dung không đổi | `304` biến mất, băng thông tăng |
| Đặt `no-store` cho toàn site | Đo lại thời gian tải lần 2 — chậm bằng lần 1 |

## What Usually Goes Wrong

- **HTML được cache lâu** → không deploy được. HTML phải `no-cache`; asset có hash mới được `max-age` dài.
- **`public` trên dữ liệu riêng tư** → data leak qua CDN. Lỗi bảo mật thật, không phải lỗi hiệu năng.
- **Vary header thiếu** — response khác nhau theo `Accept-Language` hoặc `Authorization` nhưng không khai báo `Vary` → cache trả sai bản.
- **Cache theo URL nhưng response phụ thuộc cookie** → cùng URL, khác người dùng, cache lẫn nhau.
- **Tưởng `no-cache` là tắt cache** → vẫn lưu, chỉ là validate.
- **Cache một response lỗi** — cache 500 hoặc một body rỗng với TTL dài.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `no-cache` = không cache | Được lưu, phải validate. `no-store` mới là không lưu |
| `304` tiết kiệm thời gian | Chỉ tiết kiệm băng thông; round-trip vẫn xảy ra |
| Cache chỉ ảnh hưởng hiệu năng | `public` sai là lỗ hổng bảo mật |
| Ctrl+F5 xoá cache cho mọi người | Chỉ cho bạn. Người dùng không làm điều đó |
| CDN purge là tức thì và toàn cầu | Có độ trễ, và không chạm được cache trên browser người dùng |
| `ETag` phải là hash của nội dung | Chỉ cần thay đổi khi nội dung thay đổi; có thể là version number |

## Debugging

1. DevTools → Network, cột **Size**: `disk cache`/`memory cache` = fresh hit; số nhỏ + status 304 = validated; số đầy đủ = miss.
2. Click request → **Headers** → xem `Cache-Control` thật mà server trả (không phải cái bạn nghĩ đã đặt — proxy có thể ghi đè).
3. Sai bản? Xác định lớp: `curl -I <url>` (bỏ qua browser) → nếu curl đúng thì lỗi ở browser cache; nếu curl sai thì đi tiếp lên CDN → origin.
4. Thêm query param vô nghĩa (`?x=1`) → nếu đúng thì đang bị cache ở một lớp nào đó theo URL.
5. So sánh 2 browser / chế độ ẩn danh để loại trừ cache cục bộ.
6. Kiểm tra `Vary` và `Age` header — `Age` cho biết response đã nằm trong shared cache bao lâu.

Nguyên tắc: **đi từ ngoài vào trong** (browser → CDN → app → Redis → DB), vì lớp ngoài dễ kiểm tra nhất.

## Production Considerations

- **`stale-while-revalidate`** cho phần lớn dữ liệu đọc nhiều: người dùng không bao giờ chờ, dữ liệu cũ tối đa N giây.
- **`Vary: Accept-Encoding`** gần như luôn cần; `Vary: Cookie` thường làm cache vô dụng — dấu hiệu bạn nên tách endpoint công khai và riêng tư.
- **CDN purge** là công cụ khẩn cấp, không phải chiến lược. Chiến lược là URL có hash.
- **Không cache lỗi**, hoặc cache rất ngắn (`max-age=0` cho 5xx).
- Đặt `Cache-Control` **ở một nơi** (proxy hoặc app), không phải cả hai — dễ mâu thuẫn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| `max-age` dài + URL có hash | tối ưu nhất | cần build pipeline sinh hash |
| `no-cache` + ETag | luôn đúng | mỗi lần vẫn một round-trip |
| `no-store` | an toàn tuyệt đối | mất hết lợi ích cache |
| `stale-while-revalidate` | nhanh và mượt | người dùng có thể thấy dữ liệu cũ |
| Cache ở CDN | giảm tải origin | invalidation khó, nguy cơ leak nếu sai `private` |

## Explain Without Notes

1. Phân biệt freshness và validation. Directive nào thuộc nhóm nào?
2. Vì sao `304` không giúp latency nhiều?
3. Vì sao asset có hash được cache 1 năm mà HTML thì không?
4. Đặt `public` sai gây lỗ hổng gì? Cho ví dụ cụ thể.
5. Dữ liệu sai trên UI — nêu thứ tự kiểm tra 4 lớp cache.

## Related

- [Từ vựng Web](00-web-vocabulary.md) — foundation: header, status code, `304`
- [Browser request → render](01-browser-request-render.md) — cache là bước 2 của pipeline
- [Next.js data cache](../03-nextjs/behavior/03-data-fetching-cache.md) — lớp cache tiếp theo
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — lớp application
- [Cache patterns](../../03-database/02-redis/03-cache-patterns.md) — cache-aside, stampede
- [HTTP semantics](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — method nào cache được
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md)
