#!/usr/bin/env python3
"""
Cross-language e2e mock for LangGraph gate + fault capture (stdlib only).
Run from passport/python with PYTHONPATH=. after provisioning + seeding.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULT_PATH = ROOT / "python_e2e_result.json"

sys.path.insert(0, str(ROOT))

from passport_sdk.client import PassportClient
from passport_sdk.exceptions import PassportGateBlockException
from passport_sdk.langgraph import guard_node, with_fault_capture


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def expiry_iso(days: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def main() -> None:
    base_url = os.environ.get("PASSPORT_BASE_URL", "http://localhost:3000")
    api_key = os.environ["PASSPORT_API_KEY"]
    operator_id = os.environ["PASSPORT_OPERATOR_ID"]
    domain = os.environ.get("E2E_DOMAIN", "CODE_GENERATION")

    client = PassportClient(api_key=api_key, base_url=base_url)

    print("[e2e] Step A: issue + finalize success")
    issued = client.issue_receipt(
        agent_id="python-e2e-agent",
        receipt_type="competence",
        input_digest=sha256_hex("e2e-step-a-input"),
        authority_scope="python.e2e",
        expiry=expiry_iso(),
        domain=domain,
    )
    receipt_id = issued["receipt_id"]
    finalized = client.finalize_receipt(
        receipt_id,
        status="success",
        output_hash=sha256_hex("e2e-step-a-output"),
    )
    if not finalized.get("receipt_id"):
        raise RuntimeError("Step A: missing receipt_id in finalize response")
    print(f"[e2e] Step A passed: {receipt_id}")

    print("[e2e] Step B: fault capture -> COMPUTE_TIMEOUT")
    fault_issued = client.issue_receipt(
        agent_id="python-e2e-agent",
        receipt_type="competence",
        input_digest=sha256_hex("e2e-step-b-input"),
        authority_scope="python.e2e",
        expiry=expiry_iso(),
        domain=domain,
    )
    fault_receipt_id = fault_issued["receipt_id"]

    def failing_node():
        raise RuntimeError("context length overflow: max tokens exceeded")

    try:
        with_fault_capture(client, fault_receipt_id, failing_node)
    except RuntimeError:
        pass

    RESULT_PATH.write_text(
        json.dumps({"receiptId": fault_receipt_id}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[e2e] Step B passed: wrote {RESULT_PATH}")

    print("[e2e] Step C: guard_node gate block after failure rate breach")

    def gated_node(state):
        return state

    gated_node = guard_node(gated_node, client, operator_id, domain)

    try:
        gated_node({"step": "should-block"})
        raise RuntimeError("Step C: expected PassportGateBlockException")
    except PassportGateBlockException as exc:
        print(f"[e2e] Step C passed: gate blocked ({exc.reason})")

    print("[e2e] All steps passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[e2e] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
