FROM python:3.12-slim

WORKDIR /app

# LibreOffice (headless) 給文件「預覽」用 - Word/Excel/PowerPoint 瀏覽器原生看不懂,
# 上傳的檔案要先轉成 PDF 才能在網頁內直接開(下載仍是原始檔案,不受影響,見
# utils/office_preview.py)。只裝 writer/calc/impress 三個元件加減少一點體積,
# 不用完整 libreoffice metapackage;fonts-noto-cjk 讓轉出來的 PDF 中文不會缺字。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    # opencv-python (pulled in by rapidocr-onnxruntime) needs GUI system libs
    # (libGL/libxcb) this slim base image lacks. Swap for the headless build -
    # same `cv2` API, no system deps.
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir opencv-python-headless==4.10.0.84 \
    && pip install --no-cache-dir --force-reinstall "numpy<2"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
