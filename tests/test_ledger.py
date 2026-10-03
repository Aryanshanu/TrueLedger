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
