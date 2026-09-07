FROM python:3.12-slim

WORKDIR /app

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
