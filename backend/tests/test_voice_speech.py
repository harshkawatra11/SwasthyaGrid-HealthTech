"""Language choice and `prepare_speech` (plan 7.8). Pure, no network."""

from app.prompts.voice_prompt import VOICE_SYSTEM_PROMPT, voice_system_prompt
from app.voice.speech import choose_language, detect_text_language, fallback_text, prepare_speech


def test_prepare_speech_replaces_leaked_ids_and_dedupes_type_token():
    assert prepare_speech("PHC kota_phc_4 needs ARV") == "PHC Kota-4 needs ARV"
    assert prepare_speech("Check chc_east today") == "Check CHC East today"


def test_prepare_speech_strips_markdown_brackets_and_emphasis():
    assert prepare_speech("**Kota** has 3 items (see table) [1]. _Urgent_") == "Kota has 3 items. Urgent"
    assert prepare_speech("- first point\n- second point") == "first point second point"
    assert prepare_speech("## Heading\nBody") == "Heading Body"
    assert prepare_speech("[the report](http://x.test/y) is ready") == "the report is ready"


def test_prepare_speech_removes_dashes_emojis_and_keeps_devanagari():
    text = "Stock" + chr(0x2014) + "low \U0001F600 ठीक है।"
    assert prepare_speech(text) == "Stock, low ठीक है।"
    assert prepare_speech("2.5 days at Dr. Rao's PHC") == "2.5 days at Dr. Rao's PHC"


def test_prepare_speech_blank_input():
    assert prepare_speech("") == ""
    assert prepare_speech("  **  ") == ""


def test_typed_language_detection():
    assert detect_text_language("Kota district mein kya haal hai?") == "hi-IN"
    assert detect_text_language("कोटा का हाल") == "hi-IN"
    assert detect_text_language("How many facilities are critical?") == "en-IN"
    assert detect_text_language("what is the haal") == "en-IN"  # one hint word is not enough


def test_choose_language_rules():
    assert choose_language("hi-IN", stt_language="en-IN", text="hello") == "hi-IN"
    assert choose_language("auto", stt_language="en-IN", text="hello") == "en-IN"
    assert choose_language("auto", stt_language="hi-IN", text="hello") == "hi-IN"
    assert choose_language("auto", stt_language="ta-IN", text="hello") == "hi-IN"
    assert choose_language("auto", stt_language="en-IN", text="कोटा कैसा है") == "hi-IN"
    assert choose_language("auto", text="Kota ka haal batao") == "hi-IN"
    assert choose_language("auto", text="Show shipments") == "en-IN"


def test_fallback_text_per_language():
    assert fallback_text("en-IN") == "Sorry, I could not reach the data service. Please try again."
    assert "data service" in fallback_text("hi-IN") and fallback_text("hi-IN") != fallback_text("en-IN")


def test_system_prompt_is_the_v2_text_without_em_dashes():
    assert voice_system_prompt(district_names=["x"]) == VOICE_SYSTEM_PROMPT
    assert VOICE_SYSTEM_PROMPT.startswith("You are Swasthya, the voice analyst")
    assert "10. If a question is ambiguous" in VOICE_SYSTEM_PROMPT
    assert chr(0x2014) not in VOICE_SYSTEM_PROMPT
