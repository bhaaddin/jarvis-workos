FROM python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b
RUN pip install --no-cache-dir --disable-pip-version-check duckdb==1.5.6
COPY worker.py /opt/table-worker.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "20s", "python", "-B", "/opt/table-worker.py"]
