FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY app/frontend/package*.json ./
RUN npm ci
COPY app/frontend/ ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

# ffmpeg 用于短剧合成
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && \
    apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends ffmpeg fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

# 先装依赖（利用 Docker 层缓存）
COPY app/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 拷贝后端代码
COPY app/backend/*.py /app/
COPY --from=frontend /frontend/dist /frontend
ENV FRONTEND_DIST=/frontend

# 数据目录（云上挂持久卷到这里）
ENV DATA_DIR=/data
RUN mkdir -p /data

# 不预置任何密钥：用户必须在「引擎设置」里接入自己的引擎
# BYOK_ONLY=1   —— 服务器不提供默认引擎，绝不替用户烧额度
# NO_LOCAL_ENV=1 —— 不读 .env，避免本机密钥被打进镜像
ENV COMFYUI_DISABLE=1
ENV DREAMCRAFT_MODE=public
ENV BYOK_ONLY=1
ENV NO_LOCAL_ENV=1
ENV PORT=8100

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8100')+'/api/runtime',timeout=3)"

CMD ["python", "main.py"]
