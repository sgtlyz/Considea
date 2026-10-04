"""Negotiator agent: one negotiate.detect call, one discussion item."""

from .definition import handle_request
from .detect import detect_difference

__all__ = ["detect_difference", "handle_request"]
