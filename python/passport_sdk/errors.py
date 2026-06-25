"""Maps thrown exceptions to Passport error tranches."""


def map_error_to_tranche(exc: BaseException) -> str:
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        message = str(exc).lower()
        if "timeout" in message or "timed out" in message or "connection" in message:
            return "COMPUTE_TIMEOUT"

    if isinstance(exc, TimeoutError):
        return "COMPUTE_TIMEOUT"

    if isinstance(exc, (TypeError, ValueError)):
        message = str(exc).lower()
        if (
            "validation" in message
            or "schema" in message
            or isinstance(exc, TypeError)
        ):
            return "LOGIC_DETECTION"

    if isinstance(exc, Exception):
        message = str(exc).lower()
        if (
            "timeout" in message
            or "timed out" in message
            or "connection" in message
            or "rate limit" in message
            or "context length" in message
        ):
            return "COMPUTE_TIMEOUT"
        if "validation" in message or "schema" in message or "invalid" in message:
            return "LOGIC_DETECTION"

    return "SLA_BREACH"
