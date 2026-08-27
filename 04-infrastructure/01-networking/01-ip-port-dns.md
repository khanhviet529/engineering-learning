# IP, port, DNS

**Position:** Process ↔ Network ↔ Process

Một service cần bind address/port; client cần resolve host và route tới endpoint. `localhost` luôn chỉ chính network namespace hiện tại.

Break: bind chỉ 127.0.0.1; dùng sai port; DNS sai; service chạy nhưng firewall/routing không tới được.
