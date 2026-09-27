"""Executes the ADK underwriting pipeline for one borrower and returns the
final decision. Requires Vertex AI credentials (GOOGLE_CLOUD_PROJECT +
application-default credentials, or GOOGLE_API_KEY) to actually call
Gemini - see README.md for local setup.
"""

from __future__ import annotations

import uuid

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agents.config import APP_NAME
from agents.pipeline import build_pipeline

_session_service = InMemorySessionService()
_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = build_pipeline()
    return _pipeline


async def evaluate_borrower(borrower_id: str) -> dict:
    """Runs the full pipeline for `borrower_id` and returns the Decision dict.

    The borrower_id is seeded into session state (not passed as a chat
    message the model could misread), so every tool function can read
    `tool_context.state["borrower_id"]` deterministically.
    """
    pipeline = _get_pipeline()
    runner = Runner(agent=pipeline, app_name=APP_NAME, session_service=_session_service)

    user_id = "system"
    session_id = f"eval-{borrower_id}-{uuid.uuid4().hex[:8]}"
    await _session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
        state={"borrower_id": borrower_id},
    )

    trigger = types.Content(
        role="user",
        parts=[types.Part.from_text(text=f"Evaluate borrower {borrower_id} for a credit decision.")],
    )
    async for _event in runner.run_async(user_id=user_id, session_id=session_id, new_message=trigger):
        pass  # Every step's side effects (ledger writes) already happened via callbacks/orchestrator.

    session = await _session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
    decision = session.state.get("decision") if session else None
    if decision is None:
        raise RuntimeError(
            f"Pipeline finished for {borrower_id!r} without producing a decision - "
            "check that all three specialist agents and the orchestrator ran."
        )
    return decision
