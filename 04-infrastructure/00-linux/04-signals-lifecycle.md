---
level: intermediate
area: infra
prerequisites:
  - 01-process-files-env.md
related:
  - 02-memory-cpu-limits.md
  - ../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md
  - ../04-kubernetes/workloads-networking/03-rollout-rollback.md
---

# Signals & lifecycle

> Mỗi lần deploy, `kubectl get pods` cho thấy pod cũ mất đúng 30 giây để biến mất — không phải 2 giây như bạn nghĩ. Exit code là 137. Trong log không có dòng nào của handler shutdown mà bạn đã viết cẩn thận. Handler đó không có bug: **nó chưa bao giờ được gọi.**

## Position

```text
Orchestrator  ──SIGTERM──▶  PID 1 trong container
                                │
                                ├─ có handler  → dọn dẹp → exit 0
                                └─ không       → (bỏ qua nếu là PID 1)
                                                  → chờ grace period
                                                  → SIGKILL → exit 137
```

## Problem

Signal là cách duy nhất hệ điều hành nói với process: "hãy dừng lại". Nếu process không nghe, nó bị giết — và mọi thứ đang dở dang biến mất:

```text
· request đang xử lý bị cắt giữa chừng → client nhận ECONNRESET
· transaction đang mở bị rollback
· job đang chạy biến mất, không ai retry
· connection tới DB/Redis không được đóng sạch → phía server chờ TCP timeout
· dữ liệu trong buffer chưa flush → mất
```

Và điều làm nó khó chẩn đoán: **mọi thứ trông bình thường.** Deploy thành công, pod mới chạy tốt, và những request bị cắt chỉ xuất hiện dưới dạng vài lỗi rải rác mà không ai điều tra vì "chỉ là do deploy".

## Mental Model

### Signal cần biết

```text
Số  Tên       Bắt được?  Ý nghĩa
15  SIGTERM   CÓ         "hãy dừng lại tử tế"     ← mặc định của orchestrator
2   SIGINT    CÓ         Ctrl-C
1   SIGHUP    CÓ         terminal đóng; theo quy ước: "nạp lại cấu hình"
9   SIGKILL   KHÔNG      giết ngay, kernel thực thi
19  SIGSTOP   KHÔNG      tạm dừng
18  SIGCONT   CÓ         tiếp tục
10  SIGUSR1   CÓ         do ứng dụng định nghĩa (Node: bật debugger)
12  SIGUSR2   CÓ         do ứng dụng định nghĩa
6   SIGABRT   CÓ         abort
11  SIGSEGV   CÓ*        lỗi truy cập bộ nhớ
```

Hai signal **không bắt được** là SIGKILL và SIGSTOP. Đó là thiết kế có chủ đích: hệ điều hành phải luôn có cách dừng một process bất kể nó viết gì.

### Exit code mã hoá nguyên nhân

```text
0        thành công
1–125    lỗi ứng dụng (do bạn định nghĩa)
128 + N  bị giết bởi signal N

  137 = 128 + 9   SIGKILL   → OOMKilled, hoặc hết grace period
  143 = 128 + 15  SIGTERM   → tắt theo yêu cầu (và app KHÔNG bắt signal)
  130 = 128 + 2   SIGINT    → Ctrl-C
```

Điểm tinh tế: **exit 143 nghĩa là app nhận SIGTERM nhưng dùng hành vi mặc định (thoát ngay).** Một app xử lý shutdown đúng cách sẽ exit **0**, không phải 143. Vì thế:

```text
exit 0    → shutdown có kiểm soát  ✓
exit 143  → thoát ngay khi nhận SIGTERM (không dọn dẹp)
exit 137  → bị SIGKILL: OOM hoặc quá grace period  ✗
```

### PID 1 không có handler mặc định

Đây là cơ chế giải thích ví dụ ở đầu note:

```text
Process thường:  nhận SIGTERM không có handler → kernel dùng hành vi mặc định = TERMINATE
PID 1:           nhận SIGTERM không có handler → BỎ QUA hoàn toàn
```

Kernel đối xử đặc biệt với PID 1 để tránh việc vô tình giết init của hệ thống. Trong container, hệ quả là:

```dockerfile
# ❌ sh là PID 1; nó không có handler SIGTERM và không forward cho con
CMD npm start
CMD ["sh", "-c", "node dist/main.js"]

# ✅ node là PID 1 và có handler của bạn
CMD ["node", "dist/main.js"]

# ✅ hoặc init nhỏ: forward signal + reap zombie
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
# hoặc: docker run --init  /  K8s: shareProcessNamespace + pause container
```

Với entrypoint script:

```bash
#!/bin/sh
set -e
./wait-for-db.sh
exec node dist/main.js       # ← 'exec' THAY THẾ shell; không có nó, shell giữ PID 1
```

Kiểm tra trong 5 giây:

```bash
docker exec <c> ps -o pid,ppid,comm
# PID 1 PHẢI là 'node'
```

### Chuỗi shutdown trên Kubernetes

```text
t=0     kubectl delete / rollout
        ├─▶ xoá pod khỏi Service endpoints   ┐
        └─▶ chạy preStop hook (nếu có)       │ SONG SONG, không tuần tự
            rồi gửi SIGTERM tới PID 1        ┘

t=0..X  app xử lý nốt request đang bay
t=grace nếu chưa exit → SIGKILL → 137
```

Điểm quan trọng nhất: **việc xoá endpoint và việc gửi SIGTERM xảy ra song song.** Load balancer cần vài trăm mili giây tới vài giây để cập nhật. Nếu app đóng listener ngay khi nhận SIGTERM, có một cửa sổ mà LB vẫn gửi traffic tới một cổng đã đóng → **502**.

Vì thế shutdown đúng phải **chờ một chút trước khi đóng**:

```text
1. readiness = false        (báo LB rút traffic)
2. CHỜ 3–5 giây             ← bước hay bị bỏ, và là nguyên nhân của 502 khi deploy
3. ngừng nhận kết nối mới
4. chờ request đang xử lý xong (có timeout)
5. đóng dependency: queue worker → Redis → DB pool
6. exit 0
```

Chi tiết implementation: [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md).

### `preStop` hook: tạo delay không cần sửa code

```yaml
lifecycle:
  preStop:
    exec: { command: ["sh", "-c", "sleep 5"] }
terminationGracePeriodSeconds: 45
```

`preStop` chạy **trước** SIGTERM, và grace period bắt đầu tính từ khi `preStop` bắt đầu. Nên:

```text
terminationGracePeriodSeconds  >  preStop + thời gian shutdown thật + biên
```

Nếu `preStop` là `sleep 30` và grace period là 30, app **không có giây nào** để dọn dẹp.

### Gửi signal bằng tay

```bash
kill -TERM <pid>          # hoặc: kill <pid>  (mặc định TERM)
kill -9 <pid>             # SIGKILL — biện pháp cuối
pkill -TERM -f "node dist"
docker stop <c>           # SIGTERM, chờ 10s, rồi SIGKILL
docker stop -t 30 <c>     # chờ 30s
docker kill <c>           # SIGKILL ngay
```

`docker stop` mặc định chỉ chờ **10 giây** — ngắn hơn nhiều so với grace period 30 giây của Kubernetes. Nếu shutdown của bạn mất 15 giây, nó hoạt động trên K8s và bị cắt ở local.

### `SIGHUP` để nạp lại cấu hình

```ts
process.on('SIGHUP', async () => {
  logger.info('reloading config');
  await reloadConfig();     // KHÔNG thoát
});
```

Đây là quy ước Unix lâu đời (nginx, PostgreSQL dùng nó). Nó cho phép đổi cấu hình mà không mất kết nối — hữu ích, nhưng nhớ rằng trong container, `SIGHUP` ít khi được gửi tự động.

### Node.js: nơi handler không chạy

```ts
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```

Ba tình huống handler **không** chạy:

```text
① PID 1 sai (shell/npm ở giữa)
② Event loop bị CHẶN bởi code đồng bộ
   → signal handler là một callback; nó chờ event loop rảnh
   → vòng lặp bận 60 giây = handler chờ 60 giây
③ SIGKILL — không bao giờ chạy
```

Điểm ② đáng nhớ: một job CPU-nặng đang chạy làm handler shutdown không bao giờ được gọi, và bạn nhận exit 137 dù code hoàn toàn đúng. Xem [Worker threads & CPU](../../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md).

Và handler phải **idempotent** — orchestrator có thể gửi SIGTERM nhiều lần:

```ts
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  // ...
}
```

### Zombie process

```text
Process con chết → entry vẫn trong bảng process cho tới khi CHA gọi wait()
   → chưa reap = ZOMBIE (trạng thái Z trong ps)
   → cha chết trước con → con được PID 1 "nhận nuôi"
   → PID 1 phải reap chúng
```

Nếu PID 1 là ứng dụng của bạn và nó spawn process con (ffmpeg, imagemagick, git), zombie sẽ tích luỹ. `tini` hoặc `--init` giải quyết điều này.

```bash
ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/'    # liệt kê zombie
```

## Example

Kiểm chứng toàn bộ chuỗi trong 3 phút:

```bash
# ① PID 1 sai
cat > Dockerfile <<'EOF'
FROM node:20-alpine
COPY app.js .
CMD npm start
EOF
docker build -t t1 . && docker run -d --name t1 t1
time docker stop t1
docker inspect t1 --format '{{.State.ExitCode}}'
# → ~10 giây, exit 137. Handler không chạy.

# ② PID 1 đúng
# CMD ["node", "app.js"]
time docker stop t2
# → tức thì, exit 0. Log shutdown xuất hiện.

# ③ Event loop bị chặn
# app.js: setInterval(() => { const t = Date.now(); while (Date.now() - t < 60000); }, 100)
time docker stop t3
# → 10 giây rồi 137, dù PID 1 đúng và handler đã đăng ký.
```

Ba thí nghiệm này phân biệt ba nguyên nhân hoàn toàn khác nhau của cùng một triệu chứng.

## Prediction

1. `CMD npm start`, gửi SIGTERM — Node có nhận không? Exit code sau `docker stop`?
2. `CMD ["node", "app.js"]` có handler SIGTERM gọi `process.exit(0)` — exit code?
3. Có handler nhưng handler không gọi `exit()` và không đóng server — chuyện gì xảy ra?
4. Không có handler nào, `CMD ["node", "app.js"]` — exit code?
5. Event loop bị chặn 60 giây bởi vòng lặp bận, SIGTERM tới — handler chạy khi nào?
6. `docker stop` mặc định, shutdown mất 15 giây — kết quả?
7. `docker stop -t 30`, cùng app — kết quả?
8. K8s `terminationGracePeriodSeconds: 30`, `preStop: sleep 30` — app có bao nhiêu giây để dọn dẹp?
9. App đóng listener ngay khi nhận SIGTERM, LB cần 1,5 giây để cập nhật — client thấy gì?
10. Thêm `sleep 5` trước khi đóng listener — client thấy gì?
11. Entrypoint script không có `exec` trước lệnh cuối — PID 1 là gì? Handler chạy không?
12. App spawn `ffmpeg` nhiều lần, PID 1 là node không reap — tích luỹ gì?
13. Exit code 143 — nghĩa là gì? Nó có phải shutdown đúng cách không?

<details>
<summary>Đáp án</summary>

1. **Không nhận** — `npm`/`sh` là PID 1, không forward. Sau 10 giây → SIGKILL → **137**.
2. **0** — shutdown có kiểm soát.
3. Process không thoát (server vẫn giữ event loop sống) → hết grace period → SIGKILL → **137**.
4. **143** = 128 + 15. Node dùng hành vi mặc định: thoát ngay, không dọn dẹp.
5. Sau khi vòng lặp xong — tức là **60 giây**. Nhưng grace period thường hết trước → SIGKILL.
6. `docker stop` chờ **10 giây** rồi SIGKILL → shutdown bị cắt ở giây thứ 10 → **137**.
7. Đủ thời gian → exit **0**.
8. **0 giây** — `preStop` ăn hết grace period, SIGTERM vừa gửi thì SIGKILL tới.
9. **502 / ECONNREFUSED** trong khoảng 1,5 giây đó.
10. Không lỗi — LB đã rút traffic trước khi listener đóng.
11. PID 1 là **shell**. Handler của Node **không chạy** vì shell không forward SIGTERM.
12. **Zombie process** — chiếm PID; đủ nhiều sẽ không fork được nữa.
13. App nhận SIGTERM và **thoát ngay theo mặc định** — nó không dọn dẹp gì. Không phải shutdown đúng cách; đúng cách là exit **0**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `CMD npm start` + `docker stop`, đo thời gian và exit code | ~10s, 137 |
| Đổi sang `CMD ["node", ...]`, lặp lại | Tức thì, 0 |
| Bỏ handler SIGTERM, lặp lại | 143 |
| Handler không đóng server, lặp lại | 137 sau grace period |
| Chặn event loop 60s rồi `docker stop` | 137 dù PID 1 đúng |
| Chuyển việc CPU sang worker thread, lặp lại | 0 |
| `docker stop` vs `docker stop -t 30` với shutdown 15s | 137 vs 0 |
| Chạy load test rồi `kubectl rollout restart`, đếm lỗi client | Số 502/ECONNRESET |
| Thêm delay 5s trước `server.close()`, lặp lại | Lỗi về 0 |
| `preStop: sleep 30` với grace period 30 | App không kịp dọn |
| Entrypoint không `exec`, `ps -o pid,comm` trong container | PID 1 là `sh` |
| Spawn 100 process con không reap, `ps -eo stat` | Zombie tích luỹ |
| `docker run --init`, lặp lại | Không zombie |
| Gửi SIGTERM hai lần nhanh cho handler không idempotent | Hai luồng shutdown, lỗi lạ |

## What Usually Goes Wrong

- **PID 1 là `sh`/`npm`** → SIGTERM không tới app; exit 137 mỗi lần deploy.
- **Entrypoint thiếu `exec`** → cùng vấn đề.
- **Không có handler SIGTERM** → exit 143, request bị cắt.
- **Handler không đóng server** → process không thoát, hết grace period.
- **Đóng listener ngay, không delay** → 502 khi deploy vì LB chưa cập nhật.
- **Event loop bị chặn** → handler không chạy dù đã đăng ký đúng.
- **`preStop` ăn hết grace period** → app không có thời gian dọn dẹp.
- **Grace period ngắn hơn thời gian shutdown** → SIGKILL, mất việc đang làm.
- **Handler không idempotent** → hai luồng shutdown chạy song song.
- **Không reap zombie** khi app spawn process con.
- **`docker stop` mặc định 10 giây** → hành vi khác K8s, tạo cảm giác sai ở local.
- **Không đo số lỗi trong cửa sổ deploy** → không biết shutdown có hoạt động không.
- **Liveness probe trả 503 khi đang shutdown** → K8s giết ngay, cắt ngắn shutdown.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| SIGTERM luôn làm process thoát | PID 1 không có handler mặc định → bỏ qua |
| SIGKILL bắt được nếu viết handler | Không — kernel thực thi |
| Exit 143 nghĩa là shutdown đúng | Nghĩa là thoát ngay khi nhận SIGTERM, không dọn dẹp |
| Exit 137 luôn là OOM | Cũng là hết grace period |
| K8s xoá endpoint trước rồi mới SIGTERM | Hai việc **song song** |
| `server.close()` là đủ | Cần readiness=false + delay trước đó |
| Handler đăng ký rồi thì chắc chắn chạy | Event loop bị chặn thì không |
| `docker stop` giống K8s | Mặc định chỉ 10 giây |
| `preStop` chạy sau SIGTERM | Nó chạy **trước** |
| Grace period chỉ tính từ SIGTERM | Nó bao gồm cả `preStop` |

## Debugging

1. **Exit code là gì?**
   ```bash
   docker inspect <c> --format '{{.State.ExitCode}} {{.State.OOMKilled}}'
   kubectl get pod <p> -o jsonpath='{..lastState.terminated.exitCode} {..lastState.terminated.reason}'
   ```
2. **137** → OOM hay grace period? `Reason: OOMKilled` phân biệt.
3. **PID 1 là gì?** `docker exec <c> ps -o pid,comm` — phải là app của bạn.
4. **App có thấy signal không?** Log ngay dòng đầu tiên của handler. Không có log = signal không tới.
5. **Handler chạy nhưng không thoát** → log từng bước với timestamp; bước nào treo?
6. **Event loop có bị chặn không?** Đo event loop lag; nếu cao, handler không chạy được.
7. **Đo số lỗi trong cửa sổ deploy** — chạy tải ổn định rồi `rollout restart`. Đây là chỉ số duy nhất đáng tin.
8. **Zombie**: `ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/'`.

## Production Considerations

- **PID 1 phải là ứng dụng của bạn**, hoặc dùng `tini`/`--init`. Đưa kiểm tra này vào smoke test.
- **`exec` ở cuối mọi entrypoint script.**
- **Handler SIGTERM và SIGINT**, idempotent, log từng bước với timestamp.
- **Delay 3–5 giây** giữa "báo not-ready" và "đóng listener" — đây là bước chống 502.
- **`terminationGracePeriodSeconds` > preStop + delay + drain + đóng dependency + biên.**
- **Liveness probe KHÔNG phản ánh trạng thái shutdown** — nếu nó trả 503, K8s giết ngay. Chỉ readiness được phản ánh.
- **Job dài phải có checkpoint** — graceful shutdown không cứu được job 10 phút với grace period 45 giây.
- **Đo số lỗi trong cửa sổ deploy như một metric.** Không đo thì không biết.
- **Test shutdown trong CI**: chạy container, gửi SIGTERM, khẳng định exit code 0 trong thời gian cho phép.
- **`docker stop -t <grace>` ở local** khớp với grace period của K8s, để hành vi giống nhau.
- **Việc CPU-nặng phải ra khỏi main thread** — nếu không, handler không chạy được khi cần nhất.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Grace period dài | mọi request kịp xong | rollout chậm (× số pod) |
| Grace period ngắn | rollout nhanh | cắt request đang xử lý |
| Delay trước khi đóng listener | không có 502 | mỗi pod chậm thêm vài giây |
| Không delay | tắt nhanh | 502 khi deploy |
| `preStop` hook | không cần sửa code | logic shutdown chia hai chỗ; ăn vào grace period |
| Handler trong code | một chỗ, kiểm soát tốt | phải viết và bảo trì |
| `tini` làm init | reap zombie, forward signal | thêm một binary |
| App làm PID 1 | đơn giản nhất | phải tự xử lý signal và reap |
| Drain timeout dài | request dài kịp xong | pod sống lâu, rollout chậm |
| Cắt kết nối sau timeout | rollout đúng hạn | vài request bị cắt |

## Explain Without Notes

1. Hai signal nào không bắt được, và vì sao thiết kế như vậy?
2. Vì sao PID 1 khác mọi process khác khi nhận SIGTERM?
3. Exit 0, 137, 143 khác nhau thế nào? Cái nào là shutdown đúng?
4. Vì sao cần delay giữa "nhận SIGTERM" và "đóng listener"?
5. Ba lý do handler SIGTERM không chạy dù đã đăng ký?
6. `preStop` chạy khi nào so với SIGTERM, và nó ảnh hưởng grace period thế nào?
7. Vì sao liveness probe không được phản ánh trạng thái shutdown?
8. Zombie process xuất hiện thế nào trong container?

## Related

- [Process, file & env](01-process-files-env.md) — PID 1, `exec`
- [Memory, CPU & limits](02-memory-cpu-limits.md) — exit 137 vì OOM
- [Debugging toolbox](07-debugging-toolbox.md) — quan sát process
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — implementation đầy đủ
- [Worker threads & CPU](../../02-backend-api/01-nodejs/runtime-io/02-worker-threads-cpu.md) — event loop bị chặn
- [Rollout & rollback](../04-kubernetes/workloads-networking/03-rollout-rollback.md) — chuỗi shutdown trên K8s
- [Readiness & liveness](../04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md) — probe nào phản ánh shutdown
- [Image & container](../02-docker/01-image-container.md) — `CMD`, `ENTRYPOINT`
- [Config & lifecycle (NestJS)](../../02-backend-api/02-nestjs/behavior/05-config-lifecycle.md) — `enableShutdownHooks`

## Version / Context

Linux. `docker stop` mặc định chờ 10 giây; Kubernetes `terminationGracePeriodSeconds` mặc định 30 giây. `tini` có sẵn qua `docker run --init`. Node.js: handler signal là callback trên event loop, nên code đồng bộ chặn nó.
