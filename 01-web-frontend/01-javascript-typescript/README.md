# JavaScript & TypeScript

Ngôn ngữ như một **runtime có mô hình đồng thời cụ thể** và một **hệ type bị xoá lúc compile**. Hai điều đó giải thích phần lớn bug mà người ta gán cho React hoặc cho framework.

## Thứ tự đọc

### Nền JavaScript

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [Event loop & async](01-event-loop-async.md) | Vì sao thứ tự log không như tôi nghĩ? |
| 2 | [Execution context & closure](03-execution-context-closure.md) | Vì sao hàm của tôi đọc giá trị cũ? |
| 3 | [Promise & concurrency](04-promise-concurrency.md) | Song song bao nhiêu là đúng? |
| 4 | [Memory & GC](05-memory-gc.md) | Vì sao RSS tăng đều rồi bị OOMKilled? |
| 5 | [Modules & bundling](06-modules-bundling.md) | Vì sao bundle 2MB, và `ERR_REQUIRE_ESM` là gì? |
| 6 | [Error handling & immutability](09-error-handling-immutability.md) | Lỗi đi đâu, và vì sao UI không cập nhật? |

### TypeScript

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 7 | [TypeScript ↔ runtime boundary](02-typescript-runtime-boundary.md) | Type nói `string`, runtime nói `undefined` — vì sao? |
| 8 | [Type system](07-typescript-type-system.md) | Làm sao để state sai không biểu diễn được? |
| 9 | [Advanced types](08-typescript-advanced-types.md) | Làm sao để type suy ra thay vì viết lại? |

Note 7 là note quan trọng nhất trong nhóm TypeScript. Đọc nó trước 8 và 9, kể cả khi bạn đã dùng TypeScript nhiều năm.

## Ba mental model làm nền cho toàn bộ frontend

1. **Một thread, lên lịch bằng queue.** Microtask cạn trước macrotask; không có gì async chạy khi call stack chưa cạn. → [Event loop](01-event-loop-async.md)
2. **Hàm ghi nhớ scope nơi nó được định nghĩa.** Đây là stale closure, và nó là behavior của JavaScript chứ không phải bug của React. → [Closure](03-execution-context-closure.md)
3. **Type biến mất lúc compile.** Mọi dữ liệu từ bên ngoài cần validation runtime. → [Runtime boundary](02-typescript-runtime-boundary.md)

Nếu bạn chỉ đọc ba note tương ứng với ba điểm trên, bạn đã có phần lớn giá trị của folder này.

## Bốn hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| `setTimeout(fn, 0)` chạy ngay | Chạy sau khi call stack cạn *và* sau hết microtask | [1](01-event-loop-async.md) |
| Closure chụp lại giá trị | Chụp *binding* — giá trị có thể đổi sau | [2](03-execution-context-closure.md) |
| TypeScript kiểm tra response của API | Không kiểm tra gì lúc runtime | [7](02-typescript-runtime-boundary.md) |
| GC tự động nên không thể leak | Leak = vô tình vẫn còn reachable | [4](05-memory-gc.md) |

## Position

```text
Browser / Node runtime
   └── JavaScript engine (V8)
         └── code của bạn  ← folder này
               ↑ TypeScript đã bị xoá ở đây
```

## Related

- [00-web-foundations/](../00-web-foundations/README.md) — runtime mà JS chạy trong đó
- [02-react/](../02-react/README.md) — nơi closure và immutability trở thành bug hàng ngày
- [02-backend-api/01-nodejs/](../../02-backend-api/01-nodejs/README.md) — cùng ngôn ngữ, khác runtime
- [Concurrency models](../../05-cross-cutting/concurrency/01-concurrency-models.md) — so sánh event loop với thread và distributed
