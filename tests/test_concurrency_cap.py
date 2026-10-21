"""Tests for the Gemini concurrency cap (agents/config.get_gemini_semaphore) -
the PDR's "a real concurrency cap on Gemini calls (a semaphore in the
pipeline runner, not just the per-instance rate limiter)". Proves the
semaphore actually bounds how many callers can be inside it at once,
rather than just trusting that `async with` was spelled correctly at the
two call sites."""

from __future__ import annotations

import asyncio

import pytest

from agents import config


@pytest.fixture(autouse=True)
def _reset_semaphore(monkeypatch):
    """Each test gets its own semaphore - the real one is a process-wide
    singleton (by design, see config.py), which would otherwise leak
    acquired/released state and max-concurrency expectations between
    tests."""
    monkeypatch.setattr(config, "_gemini_semaphore", None)
    yield
    monkeypatch.setattr(config, "_gemini_semaphore", None)


def test_get_gemini_semaphore_returns_the_same_instance():
    a = config.get_gemini_semaphore()
    b = config.get_gemini_semaphore()
    assert a is b


async def _worker(semaphore: asyncio.Semaphore, concurrent_count: list[int], max_seen: list[int], hold_seconds: float):
    async with semaphore:
        concurrent_count[0] += 1
        max_seen[0] = max(max_seen[0], concurrent_count[0])
        await asyncio.sleep(hold_seconds)
        concurrent_count[0] -= 1


def test_semaphore_caps_actual_concurrent_holders(monkeypatch):
    monkeypatch.setattr(config, "GEMINI_MAX_CONCURRENCY", 2)
    semaphore = config.get_gemini_semaphore()

    concurrent_count = [0]
    max_seen = [0]

    async def _run():
        await asyncio.gather(*(_worker(semaphore, concurrent_count, max_seen, 0.05) for _ in range(6)))

    asyncio.run(_run())

    assert max_seen[0] == 2  # never more than GEMINI_MAX_CONCURRENCY holders at once
    assert concurrent_count[0] == 0  # every worker released cleanly
