"""SmartHealthAgent-style Gemini tool-calling orchestration.

Agent loop: user message -> Gemini decides which tool(s) to call -> tools
execute against services/ -> results fed back -> final natural-language answer.
Max 5 iterations with a graceful fallback if the API key/quota is unavailable
or the loop stalls.

Gemini is used for EXPLANATION only, never prediction (docs/05-ai-engine.md) —
every tool call reads already-computed forecasts/recommendations; the model
just narrates them.

Uses the `google-genai` SDK (the successor to the deprecated
`google-generativeai` package, which mishandles newer non-`AIza`-prefixed
API key formats and mistakenly sends them as OAuth bearer tokens).
"""

import logging

from app.core.config import Settings
from app.logistics.protocol import InsightsQuery, LogisticsQuery
from app.prompts.system_prompt import SYSTEM_PROMPT
from app.services.district_service import DistrictService
from app.services.forecast_service import ForecastService
from app.services.recommendation_service import RecommendationService
from app.tools.v2 import build_tools

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 5

FALLBACK_MESSAGE = (
    "Ask SwasthyaGrid is unavailable right now — no GEMINI_API_KEY is configured "
    "or the Gemini API could not be reached. The rest of the dashboard (forecasts, "
    "recommendations, district map) works independently of this feature."
)


class HealthAgent:
    def __init__(
        self,
        settings: Settings,
        district: DistrictService,
        forecast: ForecastService,
        recommendation: RecommendationService,
        logistics: LogisticsQuery | None = None,
        insights: InsightsQuery | None = None,
    ):
        self.settings = settings
        # When logistics/insights are not passed, the v2 tools resolve them
        # lazily from app.api.deps at call time (lane A provides them).
        self.tools = build_tools(district, forecast, recommendation, logistics, insights)
        self._client = None

        if settings.gemini_api_key:
            try:
                from google import genai

                self._client = genai.Client(api_key=settings.gemini_api_key)
            except Exception:  # pragma: no cover - defensive, library/env issues
                logger.exception("Failed to initialize Gemini client")
                self._client = None

    def ask(self, message: str) -> dict:
        if self._client is None:
            return {"answer": FALLBACK_MESSAGE, "tool_calls": [], "confidence": None}

        try:
            from google.genai import types

            chat = self._client.chats.create(
                model=self.settings.gemini_model,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    tools=self.tools,
                ),
            )
            response = chat.send_message(message)
            tool_calls = [
                part.function_call.name
                for content in chat.get_history()
                for part in (content.parts or [])
                if getattr(part, "function_call", None)
            ][:MAX_TOOL_ITERATIONS]
            return {
                "answer": response.text,
                "tool_calls": tool_calls,
                "confidence": 90 if tool_calls else 70,
            }
        except Exception:  # pragma: no cover - network/quota failures
            logger.exception("Gemini agent loop failed")
            return {"answer": FALLBACK_MESSAGE, "tool_calls": [], "confidence": None}
