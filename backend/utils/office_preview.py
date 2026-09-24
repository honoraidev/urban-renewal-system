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
from pathlib import Path

CONVERTIBLE_EXTS = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}


def _cache_path_for(file_path: str) -> str:
    cache_dir = os.path.join(os.path.dirname(file_path), ".preview_cache")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, os.path.basename(file_path) + ".pdf")


_WINDOWS_SOFFICE_PATHS = (
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
)


def _find_soffice() -> str:
    """NAS 的 docker 映像有裝 LibreOffice(PATH 上就有 soffice);本機 Windows 開發機
    通常不在 PATH 上,再找預設安裝位置。都找不到就丟出看得懂的錯誤,不是 WinError 2。"""
    found = shutil.which("soffice") or shutil.which("soffice.exe")
    if found:
        return found
    for path in _WINDOWS_SOFFICE_PATHS:
        if os.path.exists(path):
            return path
    raise RuntimeError("這台伺服器沒有安裝 LibreOffice,無法預覽 Word/Excel/PowerPoint,請改用下載查看")


def convert_to_pdf(file_path: str) -> str:
    """回傳轉好的 PDF 路徑;失敗時丟例外(訊息帶 LibreOffice 的 stderr)。"""
    # 本機 Windows 的上傳路徑長得像「/app/uploads 加反斜線子目錄」(沒有磁碟代號、斜線混用),
    # Python 讀得到,但 LibreOffice 認不得 → 先轉成完整的絕對路徑。
    file_path = os.path.abspath(file_path)
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
                _find_soffice(),
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
                # Windows 路徑要轉成 file:///C:/... 的形式 LibreOffice 才認得
                f"-env:UserInstallation={Path(profile_dir).as_uri()}",
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
