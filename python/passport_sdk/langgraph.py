from collections.abc import Callable
from typing import Any, TypeVar

from passport_sdk.errors import map_error_to_tranche
from passport_sdk.exceptions import PassportGateBlockException

T = TypeVar("T")


def gate_checkpoint(client, operator_id: str, domain: str) -> Callable[[], None]:
    """Returns a callable invoked before a LangGraph state transition."""

    def check() -> None:
        result = client.query_gate(operator_id, domain)
        if not result.get("allow_invocation", False):
            raise PassportGateBlockException(
                operator_id,
                domain,
                str(result.get("reason", "gate_denied")),
            )

    return check


def guard_node(
    fn: Callable[..., T],
    client,
    operator_id: str,
    domain: str,
) -> Callable[..., T]:
    """Wraps a LangGraph node with a pre-transition gate check."""

    checkpoint = gate_checkpoint(client, operator_id, domain)

    def wrapped(*args: Any, **kwargs: Any) -> T:
        checkpoint()
        return fn(*args, **kwargs)

    return wrapped


def with_fault_capture(client, receipt_id: str, fn: Callable[[], T]) -> T:
    """Runs fn; on failure finalizes failure_tombstone and re-raises."""

    try:
        return fn()
    except Exception as exc:
        terminal_reason = str(exc)
        client.finalize_receipt(
            receipt_id,
            status="failure_tombstone",
            error_tranche=map_error_to_tranche(exc),
            terminal_reason=terminal_reason,
        )
        raise
