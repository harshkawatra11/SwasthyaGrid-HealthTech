"""Cross-lane contracts between the logistics service and its consumers.

Consumers (the voice tools, the insights endpoints) code and test against
these protocols. Return values are plain dicts shaped like the JSON in the
build plan (section 6), produced with `model_dump(mode="json")`.
"""

from datetime import datetime
from typing import Protocol


class LogisticsQuery(Protocol):
    def now(self) -> datetime: ...

    def list_shipments(
        self,
        district_id: str | None = None,
        facility_id: str | None = None,
        statuses: list[str] | None = None,
        limit: int = 50,
    ) -> list[dict]: ...  # ShipmentSummary dicts

    def get_shipment(self, shipment_id: str) -> dict: ...  # ShipmentDetail dict

    def latest_active_for_facility(self, facility_id: str) -> dict | None: ...

    def fleet_status(self, district_id: str | None = None) -> dict: ...

    def facility_inbound(self, facility_id: str) -> list[dict]: ...

    def kpis(self, district_id: str | None = None) -> dict: ...


class InsightsQuery(Protocol):
    def state_summary(self, district_id: str | None = None) -> dict: ...
