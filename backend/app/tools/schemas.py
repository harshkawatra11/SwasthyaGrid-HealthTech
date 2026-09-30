"""OpenAI-dialect JSON tool schema for the Sarvam voice agent (tool set v2).

Gemini's SDK introspects the callables in `app.tools.v2`; Sarvam needs this
explicit schema. A parity test keeps names and parameters in step with the
callables.
"""


def _fn(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required or []},
        },
    }


_DISTRICT = {
    "type": "string",
    "description": "District name as spoken or written, in English or Hindi, e.g. Kota, Alwar, Jaipur Rural, "
    "Bikaner, Udaipur, कोटा, जयपुर, अलवर, बीकानेर, उदयपुर, or a district id.",
}
_FACILITY = {
    "type": "string",
    "description": "Facility name as spoken or written, in English or Hindi, e.g. PHC Kota-4, Kota ka PHC chaar, "
    "PHC Kota do, rural fourteen, CHC East, पीएचसी कोटा चार, or a facility id. Number words (chaar, char, "
    "do, teen, चार, दो, तीन) and digits both resolve.",
}
_LIMIT = {"type": "integer", "description": "Maximum rows to return. Default 5."}

TOOL_SCHEMAS: list[dict] = [
    _fn(
        "get_state_briefing",
        "Overview of all five districts together: risk counts, risk index, critical facilities, top shortages, "
        "pending recommendations, shipments in transit and delayed. Use only when no single district is named, "
        "e.g. 'how is the state doing' or 'give me the overview'. If one district is named, in English or Hindi, "
        "call get_district_briefing for that district instead, even for a general 'tell me about X' or "
        "'X jile ki jankari do' request.",
        {},
    ),
    _fn(
        "get_district_briefing",
        "Full briefing for one named district: facilities with their worst issue, shortages, beds over 85 percent "
        "next week, high-risk doctors, diagnostics down, top pending recommendations, inbound shipments "
        "with ETA, footfall tomorrow and causal chain. Use this whenever a specific district is named, in English "
        "or Hindi, however the question is phrased, e.g. 'Kota district briefing', 'tell me about Bikaner', or "
        "'Jaipur jile ki poori jankari dijiye'.",
        {"district": _DISTRICT},
        ["district"],
    ),
    _fn(
        "find_facility",
        "Find or disambiguate a facility by a partial or uncertain spoken name, when you are not sure which "
        "facility is meant or there may be more than one match. Returns up to three matches with risk and match "
        "score, but no medicine, bed, doctor or shipment detail. If the officer actually asked for a facility's "
        "status, risk or data, call get_facility_status directly instead: it resolves spoken and Hindi names "
        "itself, so you do not need to look the facility up first.",
        {"query": {"type": "string", "description": "The spoken or written facility name."}, "district": _DISTRICT},
        ["query"],
    ),
    _fn(
        "get_facility_status",
        "Everything about one named facility: risk, each medicine with days of cover and confidence, beds now and "
        "next week, doctors, diagnostics, inbound shipments with ETA and pending recommendations. Call this "
        "directly for any status or 'haal kya hai' style question about a facility named in English or Hindi, "
        "including with Hindi number words (do, teen, chaar) for the facility's number; it resolves the name "
        "itself, so find_facility is not a prerequisite.",
        {"facility": _FACILITY},
        ["facility"],
    ),
    _fn(
        "get_shortages",
        "Medicines running low across facilities, sorted by days of cover left. Optionally filter by "
        "district or medicine.",
        {
            "district": _DISTRICT,
            "medicine": {"type": "string", "description": "Medicine name, e.g. ARV, ORS, Oxytocin."},
            "max_days": {"type": "number", "description": "Only rows with fewer days of cover than this. Default 7."},
        },
    ),
    _fn(
        "compare_districts",
        "Rank the five districts on one metric.",
        {
            "metric": {
                "type": "string",
                "enum": [
                    "risk_index",
                    "critical_facilities",
                    "stockouts",
                    "bed_pressure",
                    "on_time_rate",
                    "pending_recommendations",
                ],
                "description": "The metric to rank by.",
            }
        },
        ["metric"],
    ),
    _fn(
        "get_recommendations",
        "AI recommendations (replenishments, stock transfers, staffing, bed redirects) with priority, "
        "confidence and ETA. Read only: you cannot approve them.",
        {
            "district": _DISTRICT,
            "status": {
                "type": "string",
                "description": "pending (default), approved, dispatched, fulfilled, rejected, expired, cancelled or all.",
            },
            "priority": {"type": "string", "enum": ["critical", "high", "normal"]},
            "limit": _LIMIT,
        },
    ),
    _fn(
        "get_shipments",
        "Medicine shipments with status, source, destination, cargo, ETA in minutes, delay and driver.",
        {
            "district": _DISTRICT,
            "facility": _FACILITY,
            "status": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": [
                        "recommended",
                        "approved",
                        "loading",
                        "in_transit",
                        "delayed",
                        "arrived",
                        "delivered",
                        "cancelled",
                    ],
                },
                "description": "Only these statuses.",
            },
            "limit": _LIMIT,
        },
    ),
    _fn(
        "get_shipment",
        "Track one shipment: status, progress percent, ETA in minutes, delay reason, vehicle, driver, "
        "temperature for cold-chain loads and the last event.",
        {
            "shipment": {
                "type": "string",
                "description": "A shipment id such as SHP-200123, or a facility name meaning the latest active shipment to it.",
            }
        },
        ["shipment"],
    ),
    _fn(
        "get_fleet_status",
        "Vehicles by live status, drivers on shift and queued shipments with the reason they are blocked.",
        {"district": _DISTRICT},
    ),
    _fn(
        "get_footfall_forecast",
        "A district's next seven days of predicted patient footfall, tomorrow's breakdown and the confidence.",
        {"district": _DISTRICT},
        ["district"],
    ),
    _fn(
        "get_causal_chain",
        "The chain of causes explaining a demand spike at a facility.",
        {"facility": _FACILITY},
        ["facility"],
    ),
    _fn(
        "get_performance",
        "Lowest facility performance scores with sub-scores for inventory, attendance, diagnostics and patient wait.",
        {"district": _DISTRICT, "worst_n": {"type": "integer", "description": "How many facilities. Default 5."}},
    ),
]

TOOL_NAMES = frozenset(spec["function"]["name"] for spec in TOOL_SCHEMAS)
