# Small image for cheap hosting: one process, one solver run at a time (see docs/DEPLOY.md).
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine ./engine
COPY server ./server
COPY web ./web
COPY LICENSE DISCLAIMER.md README.md ./
RUN useradd --create-home app && chown -R app /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers"]
