FROM python:3.12-slim

WORKDIR /app

# paddlepaddle's shared libs are linked against OpenMP (libgomp1), which the slim base
# image doesn't ship - without it `import paddle` fails with an OSError at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    # opencv-python needs GUI system libraries (libGL/libxcb) this slim base image doesn't have.
    # Swap it for the headless build - same `cv2` API, no system deps.
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir opencv-python-headless==5.0.0.93 \
    # Force reinstall onnxruntime-gpu for CUDA acceleration if available.
    && pip uninstall -y onnxruntime \
    && pip install --no-cache-dir --force-reinstall onnxruntime-gpu==1.20.2 \
    # PaddleOCR is the primary OCR engine. Installed as its own step, deliberately kept out
    # of requirements.txt: on Windows dev machines several of paddleocr's transitive deps
    # need a C++ compiler, but linux/amd64 has manylinux wheels for all of them. CPU
    # build of paddlepaddle - GPU would need paddlepaddle-gpu with a matching CUDA
    # toolchain, a separate exercise. paddlepaddle 2.x requires numpy<2 (already capped
    # in requirements.txt); force-reinstall it afterwards in case a transitive bumped it.
    && pip install --no-cache-dir "paddlepaddle>=2.5,<2.7" "paddleocr>=2.7,<3.0" \
    && pip install --no-cache-dir --force-reinstall "numpy<2"

# onnxruntime's CUDA execution provider dlopen()s cuDNN/cuBLAS/etc. at runtime instead
# of linking them at build time - it doesn't search site-packages on its own, so the
# pip-installed nvidia-*-cu12 wheels' bundled .so files need to be on the loader path
# explicitly. Wildcarded via a shell glob at container start (not baked in at build
# time) since each nvidia-*-cu12 package's exact installed version can drift between
# rebuilds.
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/curand/lib:/usr/local/lib/python3.12/site-packages/nvidia/cufft/lib:/usr/local/lib/python3.12/site-packages/nvidia/cusparse/lib:/usr/local/lib/python3.12/site-packages/nvidia/cusolver/lib:/usr/local/lib/python3.12/site-packages/nvidia/nvjitlink/lib:/usr/local/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib:/usr/local/lib/python3.12/site-packages/nvidia/cuda_runtime/lib

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
