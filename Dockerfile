FROM node:22-bookworm-slim AS agent-dependencies
WORKDIR /app/agent/pi-base
RUN npm install --global pnpm@11.19.0
COPY agent/pi-base/package.json agent/pi-base/pnpm-lock.yaml agent/pi-base/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    CONCLAVE_MODE=mock \
    CONCLAVE_DB=/data/conclave.sqlite3 \
    CONCLAVE_WORKERS=2
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home appuser \
    && mkdir /data && chown appuser:appuser /data
COPY --from=agent-dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY workflow/requirements.txt /app/workflow/requirements.txt
RUN pip install --no-cache-dir -r workflow/requirements.txt
COPY --chown=appuser:appuser . /app
COPY --from=agent-dependencies --chown=appuser:appuser /app/agent/pi-base/node_modules /app/agent/pi-base/node_modules
USER appuser
EXPOSE 10000
CMD ["python", "-m", "deploy.start"]
