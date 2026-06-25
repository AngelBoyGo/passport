class PassportHTTPError(Exception):
    """Raised when the Passport API returns a non-retryable HTTP error."""

    def __init__(self, message: str, status: int | None = None, body: object | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


class PassportGateBlockException(Exception):
    """Raised when the gate denies invocation before a state transition."""

    def __init__(self, operator_id: str, domain: str, reason: str):
        super().__init__(f"Gate blocked for {operator_id}/{domain}: {reason}")
        self.operator_id = operator_id
        self.domain = domain
        self.reason = reason
