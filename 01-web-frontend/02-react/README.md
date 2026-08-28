# React

React như một **mô hình render**, không như một tập hook. Nếu bạn hiểu render/commit, snapshot của state, và reconciliation, thì mọi hook đều suy ra được. Nếu học hook trước, mỗi hook là một luật rời rạc phải ghi nhớ.

Baseline: **React 19.2** (ghi rõ khi behavior khác React 18).

## Cấu trúc

```text
fundamentals/   từ vựng và mô hình render — ĐỌC TRƯỚC nếu bạn mới với React
behavior/       hành vi sâu, failure mode, debugging, trade-off
```

## Thứ tự đọc

### Bước 0 — từ vựng (bỏ qua nếu đã quen React)

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0a | [Component & rendering model](./fundamentals/01-components-and-rendering-model.md) | Element khác component ở đâu? State thật sự sống ở chỗ nào? |
| 0b | [Năm hook cốt lõi](./fundamentals/02-hooks-core.md) | Khi nào `useState`, khi nào `useRef`, khi nào KHÔNG dùng `useEffect`? |
| 0c | [Bản đồ hooks nâng cao](./fundamentals/03-hooks-advanced-map.md) | 13 hook còn lại tồn tại để giải quyết gì? |

### Nền — đọc theo đúng thứ tự này

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [State → render](./behavior/01-state-render.md) | `setN(n+1)` ba lần tăng mấy? Render khác commit ở đâu? |
| 2 | [Reconciliation & keys](./behavior/05-reconciliation-keys.md) | Vì sao input mất chữ khi sắp xếp lại list? |
| 3 | [Effects & lifecycle](./behavior/02-effects-lifecycle.md) | Effect chạy 2 lần, chạy vô hạn, đọc giá trị cũ — vì sao? |
| 4 | [Props, composition & state design](./behavior/06-props-composition-state-design.md) | State nên đặt ở đâu? |
| 5 | [useReducer & state machine](./behavior/14-usereducer-state-machines.md) | Sáu boolean cho 64 tổ hợp — làm sao chỉ còn 4? |

### Async và dữ liệu

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 6 | [Async race condition](./behavior/03-async-race-condition.md) | Vì sao UI hiện dữ liệu của user khác? |
| 7 | [Server state & cache](./behavior/04-server-state-cache.md) | Vì sao dữ liệu từ API cần một công cụ riêng? |
| 8 | [Error boundaries & Suspense](./behavior/09-error-boundaries-suspense.md) | Vì sao một lỗi nhỏ làm trắng cả trang? |

### Xây dựng

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 9 | [Refs & uncontrolled](./behavior/08-refs-uncontrolled.md) | Giá trị nào không nên là state? |
| 10 | [Forms](./behavior/10-forms.md) | Validation ở client dùng để làm gì? |
| 11 | [Custom hooks](./behavior/11-custom-hooks.md) | Khi nào một hàm nên là hook? |

### Tối ưu và kiểm chứng

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 12 | [Context & memoization](./behavior/07-context-memoization.md) | Vì sao `memo` thường không giúp gì? |
| 13 | [React performance](./behavior/12-performance.md) | Chậm ở đâu, và sửa theo thứ tự nào? |
| 14 | [Testing React](./behavior/13-testing-react.md) | Test cái gì để nó không hỏng khi refactor? |

## Ba mental model quyết định

1. **Render ≠ commit.** Component function chạy lại không có nghĩa DOM đổi. → [1](./behavior/01-state-render.md)
2. **State là snapshot.** Trong một lần render, state là hằng số. Đây là [closure](../01-javascript-typescript/fundamentals/01-execution-context-closure.md), không phải cơ chế riêng của React. → [1](./behavior/01-state-render.md)
3. **Effect để đồng bộ với hệ thống bên ngoài**, không phải để phản ứng với thay đổi. Nếu không mô tả được cleanup thì có lẽ không cần effect. → [3](./behavior/02-effects-lifecycle.md)

## Sáu hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| `setState` cập nhật biến ngay | Nó lên lịch render; biến hiện tại bất biến | [1](./behavior/01-state-render.md) |
| Effect chạy 2 lần là bug của React | Là kiểm tra chủ động; cleanup thiếu là bug của bạn | [3](./behavior/02-effects-lifecycle.md) |
| `key={index}` ổn nếu list "không đổi" | Sai ngay khi có reorder/insert/delete | [2](./behavior/05-reconciliation-keys.md) |
| `memo` làm component nhanh hơn | Nó *bỏ* render; nếu render vốn rẻ thì chỉ thêm chi phí | [11](./behavior/07-context-memoization.md) |
| ErrorBoundary bắt mọi lỗi | Không bắt lỗi trong event handler và async | [7](./behavior/09-error-boundaries-suspense.md) |
| Validation ở client là bảo mật | Là UX; chỉ server bảo vệ | [9](./behavior/10-forms.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| State không cập nhật | mutate, hoặc không dùng updater function → [1](./behavior/01-state-render.md) |
| Input mất chữ / checkbox nhảy dòng | `key` → [2](./behavior/05-reconciliation-keys.md) |
| Giá trị trong callback là giá trị cũ | stale closure → [3](./behavior/02-effects-lifecycle.md) |
| Render vô hạn | `setState` trong render hoặc effect thiếu deps → [3](./behavior/02-effects-lifecycle.md) |
| UI hiện dữ liệu không khớp lựa chọn | race condition → [5](./behavior/03-async-race-condition.md) |
| Bấm nút không có gì xảy ra | lỗi trong handler không được catch → [7](./behavior/09-error-boundaries-suspense.md) |
| Trang trắng | thiếu error boundary → [7](./behavior/09-error-boundaries-suspense.md) |
| Gõ input bị lag | state quá cao → [4](./behavior/06-props-composition-state-design.md), [12](./behavior/12-performance.md) |
| Scroll list dài giật | cần virtualization → [12](./behavior/12-performance.md) |
| Context làm cả app render | value không memo → [11](./behavior/07-context-memoization.md) |

## Position

```text
Browser → React (state → render → commit → DOM) → HTTP → Backend
              ↑ folder này
```

## Related

- [01-javascript-typescript/](../01-javascript-typescript/README.md) — closure, event loop, immutability là nền của React
- [03-nextjs/](../03-nextjs/README.md) — React trên server, routing, caching
- [00-web-foundations/](../00-web-foundations/README.md) — DOM và rendering pipeline mà React ghi vào
- [Frontend performance](../../05-cross-cutting/performance/02-frontend-performance.md)
- [Testing](../../05-cross-cutting/testing/README.md)
