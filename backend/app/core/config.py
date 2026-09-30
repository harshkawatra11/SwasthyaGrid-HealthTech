from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "SwasthyaGrid AI"
    environment: str = "local"

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    google_maps_api_key: str | None = None
    use_vertex_ai: bool = False
    use_secret_manager: bool = False
    google_cloud_project: str | None = None

    sarvam_api_key: str | None = None
    sarvam_chat_model: str = "sarvam-105b-conversations"
    sarvam_stt_model: str = "saaras:v3-realtime"
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_speaker: str = "simran"
    sarvam_tts_mode: str = "ws"  # "ws" or "rest"; probe P0.2 confirmed ws works
    sarvam_stream_with_tools: bool = True  # probe P0.2 confirmed intact streamed tool calls
    voice_language: str = "auto"

    data_source: str = "auto"  # auto | seed | firestore
    firebase_service_account: str | None = None  # base64 or raw JSON
    firebase_service_account_file: str | None = None

    logistics_time_scale: float = 60.0
    logistics_scenario_start: str | None = None
    logistics_auto_pod_minutes: int = 240
    logistics_background_traffic: bool = True
    logistics_tick: bool = True
    logistics_admin_enabled: bool = True
    logistics_service_token: str | None = None
    logistics_state_path: Path = Path(__file__).resolve().parents[2] / ".runtime" / "logistics_state.json"

    seed_data_path: Path = Path(__file__).resolve().parents[2] / "data" / "seed_districts.json"

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    # Dev-only: lets lane worktrees on ports 3000 to 3099 reach the API.
    cors_origin_regex: str | None = r"http://(localhost|127\.0\.0\.1):30\d\d"

    @property
    def effective_cors_origin_regex(self) -> str | None:
        return None if self.environment == "production" else self.cors_origin_regex


@lru_cache
def get_settings() -> Settings:
    return Settings()
