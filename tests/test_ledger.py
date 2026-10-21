from agents.firestore_gateway import _format_step_id
from agents.ledger import parse_findings_payload


def test_parse_findings_payload_passes_through_dict():
    assert parse_findings_payload({"agent": "bank_statement_agent"}) == {"agent": "bank_statement_agent"}


def test_parse_findings_payload_parses_raw_json_string():
    """investment_agent has no output_schema (see its build function - the
    output_schema + AFC combination never converged live for that agent),
    so ADK hands back the model's raw text instead of a validated dict."""
    assert parse_findings_payload('{"agent": "investment_agent"}') == {"agent": "investment_agent"}


def test_parse_findings_payload_strips_markdown_fences():
    fenced = "```json\n{\"agent\": \"investment_agent\"}\n```"
    assert parse_findings_payload(fenced) == {"agent": "investment_agent"}


def test_step_id_embeds_borrower_id_so_different_borrowers_cannot_collide():
    """Regression test for the ledger step-id race/collision: step_ids used
    to be f"stp_{count:05d}" with no borrower_id in them, and every
    borrower's count restarts at 0 - so borrower A's first step and
    borrower B's first step were literally the same Firestore document id
    in the single global `ledger` collection, and the second write
    silently overwrote the first borrower's entry."""
    assert _format_step_id("b_clean", 1) != _format_step_id("b_contradiction", 1)
    assert _format_step_id("b_clean", 1) == "stp_b_clean_00001"
    assert _format_step_id("b_clean", 2) == "stp_b_clean_00002"
