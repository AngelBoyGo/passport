"""
1-line Python Decorator for Agent Task Execution Auditing.
Compatible with LangGraph node functions, CrewAI tasks, and FastAPI endpoints.
Stdlib-only (no required third-party dependencies).
"""

import functools
import hashlib
import json
import time
from typing import Any, Callable, Optional


def _canonical_json(obj: Any) -> str:
    """Deterministic canonical JSON serialization with sorted keys."""
    if isinstance(obj, dict):
        return json.dumps(obj, sort_keys=True, separators=(",", ":"))
    return json.dumps(obj, separators=(",", ":"))


def _sha256_hex(data: str) -> str:
    """SHA-256 hex digest of UTF-8 string data."""
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def passport_audit(
    subject_commitment: str,
    source_type: str = "task_deliverable",
    sign_digest_fn: Optional[Callable[[str], str]] = None,
    client: Optional[Any] = None,
    service_token: Optional[str] = None,
):
    """
    Decorator that intercepts function execution, computes input/output digests,
    captures latency and error classifications, and prepares/dispatches Passport evidence.
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start_ms = time.time()
            input_data = {"args": args, "kwargs": kwargs}
            input_digest = _sha256_hex(_canonical_json(input_data))

            try:
                result = func(*args, **kwargs)
                end_ms = time.time()
                latency_ms = int((end_ms - start_ms) * 1000)

                output_digest = _sha256_hex(_canonical_json(result))
                payload = {
                    "task_id": f"task-{int(start_ms * 1000)}",
                    "digest": output_digest,
                    "latency_ms": latency_ms,
                    "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end_ms)),
                }

                if sign_digest_fn and client:
                    try:
                        canonical = _canonical_json(payload)
                        digest = _sha256_hex(canonical)
                        signature = sign_digest_fn(digest)
                        client.post_evidence(
                            subject_commitment,
                            source_type,
                            payload,
                            signature,
                            service_token=service_token,
                        )
                    except Exception:
                        pass

                return result

            except Exception as err:
                end_ms = time.time()
                latency_ms = int((end_ms - start_ms) * 1000)
                error_msg = str(err).lower()

                error_tranche = "SLA_BREACH"
                if any(w in error_msg for w in ["timeout", "timed out", "rate limit", "429"]):
                    error_tranche = "COMPUTE_TIMEOUT"
                elif any(w in error_msg for w in ["schema", "validation", "type error", "parse"]):
                    error_tranche = "LOGIC_DETECTION"

                payload = {
                    "task_id": f"fail-{int(start_ms * 1000)}",
                    "digest": input_digest,
                    "error_classification": error_tranche,
                    "latency_ms": latency_ms,
                    "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end_ms)),
                }

                if sign_digest_fn and client:
                    try:
                        canonical = _canonical_json(payload)
                        digest = _sha256_hex(canonical)
                        signature = sign_digest_fn(digest)
                        client.post_evidence(
                            subject_commitment,
                            source_type,
                            payload,
                            signature,
                            service_token=service_token,
                        )
                    except Exception:
                        pass

                raise err

        return wrapper

    return decorator
