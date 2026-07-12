"""Security guardrails (Principle 7) and per-user rate limiting (Principle 1 — gateway).

- guard_prompt: rejects obvious prompt-injection / system-prompt-exfiltration attempts before
  they reach the model. Deliberately narrow patterns to avoid false positives on normal questions.
- RateLimiter: a token-bucket limiter applied as a FastAPI dependency on the AI routes, so one
  user can't exhaust the local model. This is on top of the existing JWT + role scoping.
"""

from __future__ import annotations

import threading
import time

from fastapi import HTTPException, status

# Narrow, high-confidence injection markers (kept tight to avoid blocking legit questions).
_INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all previous",
    "disregard the above",
    "disregard previous",
    "reveal your system prompt",
    "print your system prompt",
    "show your system prompt",
    "jailbreak",
    "developer mode",
)


def injection_hits(text: str) -> list[str]:
    t = text.lower()
    return [m for m in _INJECTION_MARKERS if m in t]


def guard_prompt(text: str) -> None:
    """Raise 400 if the input looks like a prompt-injection attempt."""
    if injection_hits(text):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Your message was blocked by the prompt-safety guard. Rephrase and try again.",
        )


class RateLimiter:
    """Per-user token bucket. Default: burst of 20, refill 0.5/sec (~30/min sustained)."""

    def __init__(self, capacity: int = 20, refill_per_sec: float = 0.5):
        self.capacity = capacity
        self.refill = refill_per_sec
        self._buckets: dict[int, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def check(self, user_id: int) -> None:
        now = time.time()
        with self._lock:
            tokens, last = self._buckets.get(user_id, (float(self.capacity), now))
            tokens = min(self.capacity, tokens + (now - last) * self.refill)
            if tokens < 1.0:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "AI rate limit reached — please slow down and retry shortly.",
                )
            self._buckets[user_id] = (tokens - 1.0, now)


ai_rate_limiter = RateLimiter()
