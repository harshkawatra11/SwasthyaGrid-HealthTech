# Microphone capture graph

Production diagnosis (2026-10-17): Sarvam STT/TTS WebSocket handshakes and typed questions succeed, including tool calls and PCM audio responses. A browser microphone session opens a running 16 kHz AudioContext but emits zero recorder-worklet messages and zero outgoing audio frames.

The recorder node had no downstream destination. Connect its output through a zero-gain node to the AudioContext destination so the browser renders the worklet graph without audible microphone monitoring. Disconnect both nodes on teardown. Verify microphone frames reach the production voice WebSocket, alongside existing typed-answer and audio playback tests.
