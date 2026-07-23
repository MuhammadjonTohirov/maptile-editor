FROM python:3.12-slim AS base

WORKDIR /app

# gdal-bin (ogr2ogr) + postgresql-client (psql) back the on-demand bulk load:
# the backend stages the OSM extract and runs the transform as subprocesses,
# so no Docker socket is exposed. They idle otherwise.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000

# The image default is production-safe; docker-compose adds --reload for
# development (rule X4).
FROM base AS production

COPY *.py ./

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test

COPY . .
RUN pip install --no-cache-dir -r requirements-dev.txt

CMD ["pytest", "-q"]
