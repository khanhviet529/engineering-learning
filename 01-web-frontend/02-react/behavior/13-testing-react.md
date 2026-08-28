---
level: intermediate
area: frontend
prerequisites:
  - 01-state-render.md
related:
  - ../../../05-cross-cutting/testing/01-testing-pyramid-behavior.md
  - ../../../05-cross-cutting/testing/04-mocking-test-doubles.md
---

# Testing React

> Test tốt mô tả **những gì người dùng làm được**, không mô tả component được implement thế nào. Đó là khác biệt giữa test bắt được bug và test hỏng mỗi lần refactor.

## Position

```text
Unit (hàm thuần) → Component (render + tương tác) → Integration (nhiều component + API mock) → E2E (browser thật)
                            ↑ note này
```

## Problem

```tsx
// ❌ Test implementation — hỏng khi refactor, không bắt được bug thật
it('sets loading state', () => {
  const { result } = renderHook(() => useTasks());
  expect(result.current.loading).toBe(true);       // chi tiết nội bộ
});

it('calls setState', () => {
  const spy = jest.spyOn(React, 'useState');       // test React, không test app
});
```

Hai test này pass khi app hỏng, và fail khi bạn đổi tên một biến nội bộ. Chúng có tỉ lệ (chi phí bảo trì)/(giá trị) rất xấu.

Câu hỏi đúng: **nếu tính năng này hỏng, người dùng sẽ thấy gì?** Test cái đó.

## Mental Model

```text
Test = { người dùng thấy gì, người dùng làm gì, kết quả người dùng thấy }
       └─ query theo role/label ─┘  └─ userEvent ─┘  └─ assert theo UI ─┘
```

Thang ưu tiên khi tìm element — đây là công cụ quan trọng nhất, vì nó gắn test với trải nghiệm thật:

```text
1. getByRole('button', { name: /lưu/i })   ← tốt nhất: giống cách screen reader thấy
2. getByLabelText('Email')                 ← form field
3. getByText(/không tìm thấy/i)            ← nội dung tĩnh
4. getByPlaceholderText(...)               ← khi không có label (nhưng nên có label)
5. getByTestId('task-row')                 ← cuối cùng, khi không còn cách nào
```

Lợi ích phụ rất thực tế: nếu bạn **không** tìm được element bằng `getByRole`, đó thường là dấu hiệu component có vấn đề accessibility. Test theo role vừa kiểm tra chức năng vừa kiểm tra a11y.

## How It Works

### Component test

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('cho phép tạo task mới', async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn();
  render(<TaskForm onCreate={onCreate} />);

  await user.type(screen.getByLabelText('Tiêu đề'), 'Viết test');
  await user.click(screen.getByRole('button', { name: /lưu/i }));

  expect(onCreate).toHaveBeenCalledWith({ title: 'Viết test' });
});

it('hiện lỗi khi tiêu đề rỗng', async () => {
  const user = userEvent.setup();
  render(<TaskForm onCreate={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: /lưu/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/bắt buộc/i);
});
```

`userEvent` thay vì `fireEvent`: nó mô phỏng chuỗi event thật (`pointerdown`, `focus`, `keydown`, `input`, `keyup`...). `fireEvent.change` bỏ qua chuỗi đó và có thể pass trong khi thao tác thật của người dùng thất bại.

### Mock ở tầng network, không tầng module

```ts
// ❌ Mock module — test không biết API thật đổi
vi.mock('./api', () => ({ getTasks: () => Promise.resolve([]) }));

// ✅ Mock HTTP — test đi qua code fetch thật, serialization thật
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('/api/tasks', () => HttpResponse.json([{ id: '1', title: 'A' }])),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` quan trọng: nó làm test fail khi component gọi một endpoint bạn chưa mock, thay vì âm thầm trả về undefined.

Vì sao mock ở tầng HTTP tốt hơn: test đi qua đúng code path của production (URL, header, parse JSON, error handling). Mock module bỏ qua tất cả và test một app không tồn tại.

### Test async

```tsx
it('hiện danh sách task', async () => {
  render(<TaskList />, { wrapper: createWrapper() });   // QueryClientProvider

  expect(screen.getByRole('status')).toBeInTheDocument();      // loading
  expect(await screen.findByText('A')).toBeInTheDocument();    // findBy = chờ
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
```

Ba họ query, dùng đúng cái:

| Query | Trả về | Dùng khi |
|---|---|---|
| `getBy*` | throw nếu không có | element **phải** có ngay |
| `findBy*` | Promise, chờ tới khi có | element xuất hiện **sau** async |
| `queryBy*` | `null` nếu không có | assert element **không** tồn tại |

Dùng `getBy*` cho element async là nguyên nhân số một của test flaky. Dùng `queryBy*` để assert tồn tại là nguyên nhân của test luôn pass.

### Test custom hook

```tsx
import { renderHook, act, waitFor } from '@testing-library/react';

it('debounce giá trị', async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
    initialProps: { v: 'a' },
  });

  rerender({ v: 'b' });
  expect(result.current).toBe('a');            // chưa đổi

  await act(async () => { vi.advanceTimersByTime(300); });
  expect(result.current).toBe('b');

  vi.useRealTimers();
});
```

Chỉ test hook trực tiếp khi nó **là** đơn vị logic độc lập. Nếu hook chỉ dùng trong một component, test component sẽ có giá trị hơn.

### Test nên viết cho cái gì

```text
✅ Người dùng làm được X (happy path chính)
✅ Người dùng thấy lỗi khi làm sai
✅ Trạng thái loading / empty / error hiển thị đúng
✅ Quy tắc nghiệp vụ (không xoá được task của người khác)
✅ Bug đã sửa (test hồi quy — mỗi bug một test)

❌ State nội bộ có giá trị gì
❌ Component render bao nhiêu lần
❌ Hàm nào được gọi (trừ khi đó là hợp đồng)
❌ Snapshot của cả cây DOM
```

Snapshot test cả cây DOM là mẫu phản diện: nó fail mỗi khi đổi class, không ai đọc diff, và mọi người `--update` một cách phản xạ. Snapshot chỉ hữu ích cho output nhỏ và ổn định (ví dụ một hàm format).

## Example

```tsx
// Test hồi quy cho một bug thật: race condition
it('không hiện dữ liệu của user cũ khi đổi nhanh', async () => {
  server.use(
    http.get('/api/users/1', async () => { await delay(200); return HttpResponse.json({ id: '1', name: 'One' }); }),
    http.get('/api/users/2', async () => { await delay(10);  return HttpResponse.json({ id: '2', name: 'Two' }); }),
  );

  const { rerender } = render(<UserProfile userId="1" />, { wrapper });
  rerender(<UserProfile userId="2" />);

  expect(await screen.findByText('Two')).toBeInTheDocument();
  await delay(300);                                     // đợi request cũ về
  expect(screen.getByText('Two')).toBeInTheDocument();  // vẫn là Two
  expect(screen.queryByText('One')).not.toBeInTheDocument();
});
```

Đây là test có giá trị cao: nó mô tả behavior người dùng, tái hiện được bug, và sẽ fail nếu ai đó xoá cleanup. Xem [Async race condition](03-async-race-condition.md).

## Prediction

1. `getByText('A')` cho element xuất hiện sau fetch — pass hay fail?
2. `queryByRole('alert')` khi alert **có** tồn tại — trả về gì?
3. `fireEvent.change(input, ...)` vs `user.type(...)` — cái nào bỏ qua focus event?
4. Mock module `./api` rồi đổi URL trong `api.ts` — test có fail?
5. Mock bằng MSW rồi đổi URL — test có fail?
6. Snapshot cả cây DOM, đổi một class name — test thế nào?

<details>
<summary>Đáp án</summary>

1. Fail — `getBy*` không chờ. Dùng `findByText`.
2. Trả về element (nó không throw, nhưng cũng không chờ) — dùng `getBy*` khi mong đợi có, `queryBy*` khi mong đợi không có.
3. `fireEvent` — nó chỉ bắn một event, bỏ qua chuỗi thật.
4. Không — mock đã thay thế module, test vẫn pass với app đã hỏng.
5. Có — vì request thật đi tới MSW và không khớp handler.
6. Fail, dù không có gì hỏng với người dùng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Dùng `getBy*` cho element async | Fail hoặc flaky |
| Dùng `queryBy*` để assert tồn tại | Test luôn pass, kể cả khi UI hỏng |
| Mock module rồi đổi URL trong module đó | Test pass, production hỏng |
| Bỏ `onUnhandledRequest: 'error'` rồi gọi endpoint chưa mock | Test pass với dữ liệu undefined |
| Xoá `<label>` khỏi input | `getByLabelText` fail → test bắt được lỗi a11y |
| Test dựa vào thứ tự chạy (state chia sẻ giữa test) | Fail khi chạy song song hoặc đổi thứ tự |
| `fireEvent.change` cho một input có logic `onFocus` | Test pass nhưng người dùng thật gặp lỗi |
| Snapshot toàn cây, đổi class | Diff lớn không ai đọc |

## What Usually Goes Wrong

- **Test implementation** → hỏng khi refactor, không bắt bug.
- **Mock quá sâu** → test một app không tồn tại.
- **`getBy*` cho async** → flaky.
- **`queryBy*` để assert có** → test vô dụng.
- **State chia sẻ giữa test** → phụ thuộc thứ tự chạy.
- **Snapshot cả cây DOM** → noise, không ai đọc.
- **Chỉ test happy path** → không test loading/error/empty, vốn là nơi bug ở.
- **Test quá nhiều ở tầng E2E** → chậm, flaky. Xem [Testing pyramid](../../../05-cross-cutting/testing/01-testing-pyramid-behavior.md).
- **`act()` warning bị bỏ qua** → dấu hiệu update xảy ra ngoài kiểm soát của test.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Coverage cao = test tốt | Coverage đo dòng chạy qua, không đo assertion có ý nghĩa |
| Nên test mọi component | Test behavior; component nhỏ thuần trình bày ít giá trị |
| `getByTestId` là cách sạch | Nó không phản ánh cách người dùng thấy; dùng cuối cùng |
| Mock nhiều = test nhanh và ổn định | Mock nhiều = test ít giá trị |
| Snapshot test là test | Chỉ phát hiện thay đổi, không kiểm tra đúng đắn |
| Test hook quan trọng hơn test component | Component test gần với người dùng hơn |
| `fireEvent` và `userEvent` tương đương | `userEvent` mô phỏng chuỗi event thật |

## Debugging

1. **Test fail không rõ lý do** → `screen.debug()` in DOM hiện tại; hoặc `screen.logTestingPlaygroundURL()` để có gợi ý query.
2. **Không tìm được element** → thông báo lỗi của Testing Library liệt kê các role có sẵn. Đọc nó.
3. **Flaky** → tìm `getBy*` cho async, timer thật, hoặc state chia sẻ giữa test. Chạy test đơn lẻ và chạy song song để so sánh.
4. **`act()` warning** → có state update ngoài `act`; thường vì thiếu `await` cho một thao tác async.
5. **Test pass nhưng production hỏng** → đang mock quá sâu. Đưa mock ra tầng HTTP.
6. Chạy với `--runInBand`/`--no-threads` để loại trừ vấn đề song song.

## Production Considerations

- **Test theo behavior** với `getByRole` là mặc định — nó kiểm tra cả chức năng và a11y.
- **MSW dùng chung** giữa test và dev (mock server khi backend chưa xong).
- **Mỗi bug production → một test hồi quy.** Đây là cách suite test trở nên có giá trị theo thời gian thay vì chỉ to ra.
- **Chạy test trong CI với `--ci`**, fail khi có `act()` warning và unhandled request.
- **Ưu tiên tầng thấp**: nhiều component test, ít E2E. E2E chỉ cho luồng quan trọng nhất (login, checkout).
- Thêm **axe** (`jest-axe`) vào component test để bắt vấn đề a11y tự động.
- Đừng đặt mục tiêu coverage tuyệt đối; đặt mục tiêu "mọi luồng người dùng quan trọng đều có test".

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Test theo role/label | bền qua refactor, kiểm tra a11y | cần markup đúng |
| `getByTestId` | dễ viết | không phản ánh trải nghiệm; markup thêm rác |
| Mock ở tầng HTTP | test đi qua code thật | setup phức tạp hơn |
| Mock module | nhanh, đơn giản | test có thể pass khi app hỏng |
| Nhiều E2E | tin cậy cao nhất | chậm, flaky, tốn hạ tầng |
| Nhiều component test | nhanh, ổn định | không bắt lỗi tích hợp thật |

## Explain Without Notes

1. Câu hỏi để quyết định test cái gì?
2. Thang ưu tiên query và vì sao `getByRole` đứng đầu?
3. `getBy*`, `findBy*`, `queryBy*` — dùng cái nào khi nào?
4. Vì sao mock ở tầng HTTP tốt hơn mock module?
5. Kể ba thứ **không** nên test và lý do.

## Related

- [State → render](01-state-render.md) — hiểu render trước khi test nó
- [Async race condition](03-async-race-condition.md) — test hồi quy cho race
- [Custom hooks](11-custom-hooks.md) — khi nào test hook trực tiếp
- [Testing pyramid](../../../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — chiến lược chung
- [Mocking & test doubles](../../../05-cross-cutting/testing/04-mocking-test-doubles.md) — mock ở tầng nào
- [Deterministic tests](../../../05-cross-cutting/testing/06-deterministic-tests.md) — chống flaky
