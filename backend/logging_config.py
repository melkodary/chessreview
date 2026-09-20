import logging

from pythonjsonlogger import jsonlogger

from config import LOG_LEVEL


def configure_logging() -> None:
    """Root logger emits single-line JSON: timestamp, level, name, message."""
    handler = logging.StreamHandler()
    handler.setFormatter(
        jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "timestamp", "levelname": "level"},
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(LOG_LEVEL)

    # Uvicorn installs its own plain-text handlers on these loggers before the
    # app is imported; clear them so the lines fall through to the root JSON
    # handler instead (uvicorn does not re-apply its config after import).
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
