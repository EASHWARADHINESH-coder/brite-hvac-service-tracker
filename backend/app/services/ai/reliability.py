"""Reliability primitives (Principle 8).

A circuit breaker that trips after repeated provider failures so we stop hammering a dead
LLM and fail fast to the deterministic fallback, plus a small retry helper. Combined with the
fallback-first design, this keeps the app responsive even when the model backend is down.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


@dataclass
class CircuitBreaker:
    """Opens after `fail_threshold` consecutive failures; stays open for `cooldown_seconds`."""

    fail_threshold: int = 3
    cooldown_seconds: float = 30.0
    _failures: int = 0
    _open_until: float = 0.0

    @property
    def is_open(self) -> bool:
        return time.time() < self._open_until

    def record_success(self) -> None:
        self._failures = 0
        self._open_until = 0.0

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self.fail_threshold:
            self._open_until = time.time() + self.cooldown_seconds
            logger.warning(
                "LLM circuit opened for %.0fs after %d consecutive failures",
                self.cooldown_seconds, self._failures,
            )

    def state(self) -> dict:
        return {
            "open": self.is_open,
            "failures": self._failures,
            "cooldown_remaining": max(0, round(self._open_until - time.time(), 1)),
        }


# One breaker guarding the LLM provider.
llm_breaker = CircuitBreaker()

# Retry decorator for transient LLM errors (2 tries, short backoff). Reuse on wrapped calls.
llm_retry = retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=0.4, max=2),
    reraise=True,
)
