# Container networking

**Position:** Container ↔ Docker network ↔ Container/Host

Failure kinh điển: app trong container gọi `localhost` và mong tới DB ở container khác/host.

Experiment: compose app + postgres; kết nối bằng service name; phân biệt container port và published host port.
