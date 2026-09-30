class SwasthyaGridError(Exception):
    """Base domain exception."""


class FacilityNotFoundError(SwasthyaGridError):
    def __init__(self, facility_id: str):
        super().__init__(f"Facility '{facility_id}' not found")
        self.facility_id = facility_id


class DistrictNotFoundError(SwasthyaGridError):
    def __init__(self, district_id: str):
        super().__init__(f"District '{district_id}' not found")
        self.district_id = district_id


class RecommendationNotFoundError(SwasthyaGridError):
    def __init__(self, recommendation_id: str):
        super().__init__(f"Recommendation '{recommendation_id}' not found")
        self.recommendation_id = recommendation_id


class MapsAPIException(SwasthyaGridError):
    def __init__(self, message: str):
        super().__init__(f"Maps API Error: {message}")


class InvalidTransitionError(SwasthyaGridError):
    """A status change that the recommendation or shipment state machine forbids (HTTP 409)."""

    def __init__(self, message: str):
        super().__init__(message)


class ShipmentNotFoundError(SwasthyaGridError):
    def __init__(self, shipment_id: str):
        super().__init__(f"Shipment '{shipment_id}' not found")
        self.shipment_id = shipment_id


class ShipmentStateError(SwasthyaGridError):
    """An action that is not allowed in the shipment's current status (HTTP 409)."""

    def __init__(self, message: str):
        super().__init__(message)


class VehicleNotFoundError(SwasthyaGridError):
    def __init__(self, vehicle_id: str):
        super().__init__(f"Vehicle '{vehicle_id}' not found")
        self.vehicle_id = vehicle_id


class DriverNotFoundError(SwasthyaGridError):
    def __init__(self, driver_id: str):
        super().__init__(f"Driver '{driver_id}' not found")
        self.driver_id = driver_id


class WarehouseNotFoundError(SwasthyaGridError):
    def __init__(self, warehouse_id: str):
        super().__init__(f"Warehouse '{warehouse_id}' not found")
        self.warehouse_id = warehouse_id


class ApiError(SwasthyaGridError):
    """An HTTP error with an explicit status and machine readable code (401, 403, 503)."""

    def __init__(self, status_code: int, detail: str, code: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
