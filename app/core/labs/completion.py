"""Complete an AI report and its calculated models as one application command."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.core.research.utils import _now
from app.schemas.labs import ValuationModelCreate

if TYPE_CHECKING:
    from app.core.labs.service import InvestmentLabService


class LabRunTerminalError(RuntimeError):
    """The persisted run was already completed, canceled or failed."""


@dataclass(frozen=True)
class LabCompletionCommand:
    user_id: str
    run: dict[str, Any]
    report: str
    models: tuple[tuple[str, str, ValuationModelCreate], ...]


class LabRunCompletionService:
    def __init__(self, service: InvestmentLabService) -> None:
        self.service = service

    def complete(
        self, command: LabCompletionCommand, checkpoint: Callable[[], None]
    ) -> dict[str, Any]:
        completed = command.run
        with self.service.unit_of_work.transaction() as transaction:
            checkpoint()
            artifacts = {item["id"]: item for item in completed["artifacts"]}
            for artifact_id, symbol, request in command.models:
                checkpoint()
                saved = self.service.create_valuation_model(
                    command.user_id, symbol, request, unit_of_work=transaction
                )
                artifacts[artifact_id]["data"]["saved_model_id"] = saved["id"]
            completed.update(status="completed", report=command.report, completed_at=_now())
            checkpoint()
            if not transaction.runs.update_running(command.user_id, completed):
                raise LabRunTerminalError("The persisted run is already terminal")
            checkpoint()
        return completed
