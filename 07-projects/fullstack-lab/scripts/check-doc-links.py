#!/usr/bin/env python3
"""Kiểm mọi liên kết tương đối giữa các tài liệu Markdown của Flowboard.

Tài liệu ở đây là hợp đồng, và một link chết trong hợp đồng không phải lỗi hình
thức: nó nghĩa là một quy tắc trỏ tới chỗ không tồn tại, và người đọc sẽ tự suy
ra quy tắc theo cách của mình.

Formatter cố ý không đụng tới Markdown (xem hàng Format trong
`docs/operations/ci-cd.md`), nên đây là bộ kiểm thay thế cho phần cấu trúc.

Chạy: python scripts/check-doc-links.py
Thoát 0 khi sạch, 1 khi có link hỏng.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Console mặc định trên Windows là cp1252 và sẽ ném UnicodeEncodeError khi in tiếng Việt.
# Một bộ kiểm chết vì thông báo của chính nó thì vô dụng, nên ép UTF-8 ngay từ đầu.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "coverage", ".git"}

INLINE_LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
REFERENCE_DEF = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
FENCE = re.compile(r"^\s*(```|~~~)")


def strip_code_fences(text: str) -> str:
    """Bỏ nội dung trong code fence, giữ nguyên số dòng để báo lỗi đúng chỗ."""
    out: list[str] = []
    in_fence = False
    for line in text.splitlines():
        if FENCE.match(line):
            in_fence = not in_fence
            out.append("")
            continue
        out.append("" if in_fence else line)
    return "\n".join(out)


def markdown_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.md")
        if not SKIP_DIRS & set(path.relative_to(ROOT).parts)
    )


def main() -> int:
    broken: list[str] = []
    files = markdown_files()

    for path in files:
        body = strip_code_fences(path.read_text(encoding="utf-8"))
        targets = INLINE_LINK.findall(body) + REFERENCE_DEF.findall(body)

        for target in targets:
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            href = target.split("#", 1)[0]
            if not href:
                continue
            resolved = (path.parent / href).resolve()
            if not resolved.exists():
                rel = path.relative_to(ROOT).as_posix()
                broken.append(f"{rel} -> {target}")

    if broken:
        print(f"{len(broken)} liên kết hỏng trong {len(files)} tài liệu:")
        for item in broken:
            print(f"  {item}")
        return 1

    print(f"OK — {len(files)} tài liệu, không có liên kết hỏng.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
