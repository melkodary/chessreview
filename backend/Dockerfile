FROM debian:trixie-slim AS stockfish-builder

ARG TARGETARCH
ARG STOCKFISH_ARCH
ARG STOCKFISH_VERSION=sf_19
ARG STOCKFISH_COMMIT=edb0d9db6731067ec50ce619ff372b463bc4dd5d

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl g++ git make \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch "${STOCKFISH_VERSION}" --depth 1 \
    https://github.com/official-stockfish/Stockfish.git /src/stockfish \
    && test "$(git -C /src/stockfish rev-parse HEAD)" = "${STOCKFISH_COMMIT}"

WORKDIR /src/stockfish/src
# Upstream net.sh fails OPEN: its `> $file` redirect creates the net even when
# curl fails, so it skips its own mirror and embeds a 0-byte net — a green build
# that dies on first search. Retry on size, not on exit code, and let bench prove the engine runs before it leaves this stage.
RUN case "${TARGETARCH}" in \
        arm64) default_arch=armv8 ;; \
        amd64) default_arch=x86-64-avx2 ;; \
        *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && for i in 1 2 3 4 5; do \
           rm -f nn-*.nnue && make net \
           && ! find . -maxdepth 1 -name 'nn-*.nnue' -size -100k | grep -q . \
           && break; \
           echo "net fetch attempt $i produced no usable net; retrying" >&2; \
           sleep 5; \
       done \
    && make -j"$(nproc)" build ARCH="${STOCKFISH_ARCH:-${default_arch}}" \
    && ./stockfish bench 16 1 5 > /dev/null \
    && strip stockfish

FROM python:3.14-slim-trixie

COPY --from=stockfish-builder /src/stockfish/src/stockfish /usr/bin/stockfish
COPY --from=stockfish-builder /src/stockfish/Copying.txt /usr/share/doc/stockfish/COPYING.txt

ENV PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
# Keep build-time tooling out of the runtime: wheel/setuptools have carried
# fixable CVEs and native dependencies must resolve compatible wheels. Add a
# builder stage if a future dependency needs native source compilation.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y setuptools wheel pip

COPY . .

# Non-root runtime. /data (the review-data volume mount) must exist and be
# app-owned *in the image* — Docker seeds a new named volume from the image
# dir's ownership. An existing root-owned volume is NOT re-chowned on mount
# (chown it once by hand when migrating).
RUN useradd --system --create-home --uid 1001 app \
    && mkdir -p /data \
    && chown -R app:app /data /app
USER app

EXPOSE 8000
CMD sh -c "uvicorn main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000}"
