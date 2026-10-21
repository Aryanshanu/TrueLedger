"""
Resilience & Circuit Breaker Engine for Outbound Model Inference (Vertex AI / Gemini).
Protects against upstream outages, rate limits, and cascading thread exhaustion.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger("trueledger.resilience")

class CircuitBreakerOpenException(Exception):
    """Raised when upstream calls are blocked by an open circuit."""
    pass

class CircuitBreaker:
    """
    3-State Circuit Breaker:
      - CLOSED: Normal operations. Failures are counted.
      - OPEN: Failures exceeded threshold. Fast-fails requests without calling upstream.
      - HALF_OPEN: Probe interval passed. Tests one request to check if upstream recovered.
    """
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout_sec: float = 30.0,
        expected_exceptions: Optional[tuple] = None,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout_sec = recovery_timeout_sec
        self.expected_exceptions = expected_exceptions or (Exception,)

        self._failure_count = 0
        self._last_failure_time = 0.0
        self._state = "CLOSED"
        self._lock = asyncio.Lock()

    @property
    def state(self) -> str:
        return self._state

    async def execute(self, func: Callable[..., Coroutine[Any, Any, Any]], *args, **kwargs) -> Any:
        now = time.time()
        async with self._lock:
            if self._state == "OPEN":
                if now - self._last_failure_time >= self.recovery_timeout_sec:
                    logger.warning("Circuit entering HALF_OPEN probe state. Testing upstream.")
                    self._state = "HALF_OPEN"
                else:
                    raise CircuitBreakerOpenException(
                        f"Circuit is OPEN. Fast-failing upstream call. Retry in {int(self.recovery_timeout_sec - (now - self._last_failure_time))}s"
                    )

        try:
            result = await func(*args, **kwargs)
            async with self._lock:
                if self._state == "HALF_OPEN":
                    logger.info("Probe succeeded! Resetting Circuit to CLOSED.")
                    self._state = "CLOSED"
                    self._failure_count = 0
            return result
        except self.expected_exceptions as exc:
            async with self._lock:
                self._failure_count += 1
                self._last_failure_time = time.time()
                logger.error("Upstream error (%d/%d): %s", self._failure_count, self.failure_threshold, exc)
                if self._failure_count >= self.failure_threshold:
                    self._state = "OPEN"
                    logger.critical("Circuit Breaker TRIPPED to OPEN! Fast-failing subsequent calls.")
            raise exc

# Singleton breaker instance for Vertex AI Gemini pipelines
gemini_circuit_breaker = CircuitBreaker(failure_threshold=4, recovery_timeout_sec=20.0)
