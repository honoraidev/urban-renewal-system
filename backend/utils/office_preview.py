"""Word/Excel/PowerPoint 檔案的「預覽」轉檔 - 瀏覽器原生只認得 PDF 和圖片,Office 檔案
點開只會變成強制下載或亂碼,所以預覽前先用 LibreOffice headless 轉成 PDF,下載功能仍然
給原始檔案(不動使用者原本的檔案)。

轉檔結果快取在來源檔案旁邊的 .preview_cache/ 子目錄,用來源檔的 mtime 判斷快取是否過期,
同一份檔案不會每次預覽都重轉一次。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

CONVERTIBLE_EXTS = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}


def _cache_path_for(file_path: str) -> str:
    cache_dir = os.path.join(os.path.dirname(file_path), ".preview_cache")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, os.path.basename(file_path) + ".pdf")


def convert_to_pdf(file_path: str) -> str:
    """回傳轉好的 PDF 路徑;失敗時丟例外(訊息帶 LibreOffice 的 stderr)。"""
    cache_path = _cache_path_for(file_path)
    if os.path.exists(cache_path) and os.path.getmtime(cache_path) >= os.path.getmtime(file_path):
        return cache_path

    out_dir = os.path.dirname(cache_path)
    # 每次轉檔用獨立的 profile 目錄,避免多人同時預覽時 LibreOffice headless 互搶
    # 使用者設定檔鎖(soffice 對同一個 profile 只能有一個 instance 在跑)。
    profile_dir = tempfile.mkdtemp(prefix="lo_profile_")
    try:
        result = subprocess.run(
            [
                "soffice",
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to",
                "pdf",
                "--outdir",
                out_dir,
                file_path,
            ],
            capture_output=True,
            timeout=120,
        )
        produced = os.path.join(out_dir, os.path.splitext(os.path.basename(file_path))[0] + ".pdf")
        if not os.path.exists(produced):
            stderr = result.stderr.decode("utf-8", errors="ignore")[:300]
            raise RuntimeError(stderr or "LibreOffice 未產生 PDF 檔")
        if produced != cache_path:
            os.replace(produced, cache_path)
        return cache_path
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)
