FROM node:24-bookworm-slim AS agent-dependencies
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY agent/pi-base/package.json agent/pi-base/pnpm-lock.yaml agent/pi-base/pnpm-workspace.yaml ./agent/pi-base/
RUN pnpm --dir agent/pi-base install --frozen-lockfile --prod
COPY agent/interview/package.json agent/interview/pnpm-lock.yaml ./agent/interview/
RUN pnpm --dir agent/interview install --frozen-lockfile --prod
COPY agent/idea/package.json agent/idea/pnpm-lock.yaml agent/idea/pnpm-workspace.yaml ./agent/idea/
RUN pnpm --dir agent/idea install --frozen-lockfile --prod
COPY agent/evaluator/package.json agent/evaluator/pnpm-lock.yaml agent/evaluator/pnpm-workspace.yaml ./agent/evaluator/
RUN pnpm --dir agent/evaluator install --frozen-lockfile --prod
# Include module development dependencies so CI can typecheck the deployed schema.
COPY agent/idea/spacetime/package.json agent/idea/spacetime/pnpm-lock.yaml agent/idea/spacetime/pnpm-workspace.yaml ./agent/idea/spacetime/
RUN pnpm --dir agent/idea/spacetime install --frozen-lockfile
COPY workflow/node/package.json workflow/node/pnpm-lock.yaml workflow/node/pnpm-workspace.yaml ./workflow/node/
RUN pnpm --dir workflow/node install --frozen-lockfile
COPY workflow/node/module_bindings ./workflow/node/module_bindings
RUN pnpm --dir workflow/node build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    CONCLAVE_MODE=mock \
    CONCLAVE_MODEL=offline \
    CONCLAVE_EVALUATOR=agent \
    CONCLAVE_DB=/data/conclave.sqlite3 \
    CONCLAVE_WORKERS=2
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home appuser \
    && mkdir /data /app && chown appuser:appuser /data /app
COPY --from=agent-dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY workflow/requirements.txt /app/workflow/requirements.txt
COPY agent/agentverse/requirements.txt /app/agent/agentverse/requirements.txt
RUN pip install --no-cache-dir -r workflow/requirements.txt -r agent/agentverse/requirements.txt
COPY --chown=appuser:appuser . /app
COPY --from=agent-dependencies --chown=appuser:appuser /app/agent /app/agent
COPY --from=agent-dependencies --chown=appuser:appuser /app/workflow/node /app/workflow/node
USER appuser
EXPOSE 10000
CMD ["python", "-m", "deploy.start"]
