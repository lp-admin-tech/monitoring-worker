"""
Structured logging using structlog.
Provides clean, readable console output for easy debugging.
"""

import logging
import sys
from typing import Any

import structlog
from structlog.types import Processor

from src.config import settings


def _add_log_level(
    logger: logging.Logger, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Add log level to the event dict."""
    if method_name == "warn":
        method_name = "warning"
    event_dict["level"] = method_name.upper()
    return event_dict


def _clean_renderer(
    logger: logging.Logger, method_name: str, event_dict: dict[str, Any]
) -> str:
    """
    Render logs in a clean, readable format.
    Format: [LEVEL] event | key=value key2=value2
    """
    level = event_dict.pop("level", "INFO")
    event = event_dict.pop("event", "")
    
    # Build the context string
    context_parts = []
    for key, value in sorted(event_dict.items()):
        if key in ("timestamp", "logger", "level"):
            continue
        # Format the value nicely
        if isinstance(value, str):
            context_parts.append(f"{key}={value}")
        elif isinstance(value, (list, dict)):
            # Truncate long lists/dicts
            str_val = str(value)
            if len(str_val) > 100:
                str_val = str_val[:100] + "..."
            context_parts.append(f"{key}={str_val}")
        else:
            context_parts.append(f"{key}={value}")
    
    context_str = " | ".join(context_parts) if context_parts else ""
    
    if context_str:
        return f"[{level}] {event} | {context_str}"
    else:
        return f"[{level}] {event}"


def setup_logging() -> None:
    """Configure structlog for the application."""
    
    # Simple processors for clean output
    processors: list[Processor] = [
        _add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        _clean_renderer,  # Custom clean renderer
    ]
    
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )


def get_logger(name: str) -> structlog.BoundLogger:
    """Get a logger instance with the given name."""
    return structlog.get_logger(name)


# Initialize logging on module import
setup_logging()
