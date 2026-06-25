import json
import os
import threading
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from passport_sdk.exceptions import PassportHTTPError

BACKOFF_SECONDS = [0.2, 0.4, 0.8]
REQUEST_TIMEOUT = 4.0
MAX_ATTEMPTS = 3


class PassportClient:
    """
    Thread-safe Passport HTTP client using urllib (stdlib only).

    Requests are stateless; a lock serializes shared counter access and is
    re-entrant safe for nested client calls from the same thread.
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        self.api_key = api_key or os.environ.get("PASSPORT_API_KEY", "")
        self.base_url = (base_url or os.environ.get("PASSPORT_BASE_URL", "")).rstrip(
            "/"
        )
        self._request_lock = threading.Lock()
        self._request_count = 0

    def issue_receipt(
        self,
        *,
        agent_id: str,
        receipt_type: str,
        input_digest: str,
        authority_scope: str,
        expiry: str,
        domain: str | None = None,
        prev_receipt_hash: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "agent_id": agent_id,
            "receipt_type": receipt_type,
            "input_digest": input_digest,
            "authority_scope": authority_scope,
            "expiry": expiry,
        }
        if domain is not None:
            payload["domain"] = domain
        if prev_receipt_hash is not None:
            payload["prev_receipt_hash"] = prev_receipt_hash

        return self._request(
            "POST",
            "/api/v1/receipts",
            payload,
            auth=True,
        )

    def finalize_receipt(
        self,
        receipt_id: str,
        *,
        status: str,
        output_hash: str | None = None,
        refusal_reason: str | None = None,
        terminal_reason: str | None = None,
        error_tranche: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"status": status}
        if output_hash is not None:
            payload["output_hash"] = output_hash
        if refusal_reason is not None:
            payload["refusal_reason"] = refusal_reason
        if terminal_reason is not None:
            payload["terminal_reason"] = terminal_reason
        if error_tranche is not None:
            payload["error_tranche"] = error_tranche

        return self._request(
            "POST",
            f"/api/v1/receipts/{receipt_id}/finalize",
            payload,
            auth=True,
        )

    def query_gate(self, operator_id: str, domain: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/gate/verify",
            {"operator_id": operator_id, "domain": domain},
            auth=False,
        )

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None,
        *,
        auth: bool,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {self.api_key}"

        last_error: Exception | None = None

        for attempt in range(MAX_ATTEMPTS):
            request = Request(url, data=body, headers=headers, method=method)

            try:
                with self._request_lock:
                    self._request_count += 1

                with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                    raw = response.read().decode("utf-8")
                    if not raw:
                        return {}
                    return json.loads(raw)
            except HTTPError as exc:
                error_body = self._read_http_error_body(exc)
                if 400 <= exc.code < 500:
                    message = self._extract_error_message(error_body, exc.code)
                    raise PassportHTTPError(message, exc.code, error_body) from exc

                last_error = PassportHTTPError(
                    f"HTTP {exc.code}",
                    exc.code,
                    error_body,
                )
            except URLError as exc:
                last_error = exc

            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(BACKOFF_SECONDS[attempt])

        if isinstance(last_error, PassportHTTPError):
            raise last_error
        raise PassportHTTPError(
            str(last_error) if last_error else "Request failed after retries"
        ) from last_error

    @staticmethod
    def _read_http_error_body(exc: HTTPError) -> object | None:
        try:
            raw = exc.read().decode("utf-8")
            return json.loads(raw) if raw else None
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None

    @staticmethod
    def _extract_error_message(body: object | None, status: int) -> str:
        if isinstance(body, dict) and isinstance(body.get("error"), str):
            return body["error"]
        return f"HTTP {status}"
