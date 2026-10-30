FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /srv/ultran

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ultran_backend ./ultran_backend
COPY pyproject.toml README.md ./

RUN useradd --create-home --uid 10001 ultran \
    && chown -R ultran:ultran /srv/ultran
USER ultran

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx,sys; sys.exit(0 if httpx.get('http://127.0.0.1:8080/v1/health', timeout=3).status_code==200 else 1)"

CMD ["uvicorn", "ultran_backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
