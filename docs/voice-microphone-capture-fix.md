# Microphone capture graph

Production diagnosis (2026-10-17): Sarvam STT/TTS WebSocket handshakes and typed questions succeed, including tool calls and PCM audio responses. A browser microphone session opens a running 16 kHz AudioContext but emits zero recorder-worklet messages and zero outgoing audio frames.

The recorder node had no downstream destination. Connect its output through a zero-gain node to the AudioContext destination so the browser renders the worklet graph without audible microphone monitoring. Disconnect both nodes on teardown. Verify microphone frames reach the production voice WebSocket, alongside existing typed-answer and audio playback tests.

On software-rendered WebGL browsers, the glass orb also stalled recorder initialization. Use the existing CSS orb when the renderer reports SwiftShader, llvmpipe, or another software rasterizer; release the capability-probe WebGL context. Hardware-rendered browsers keep the glass orb. Production reduced-motion verification sent 237 microphone frames, received 42 audio frames, and transcribed “Which district needs attention first?” correctly.

Playback diagnosis: output was resumed only when asynchronous TTS arrived, outside the initiating click. Explicitly resume the playback context synchronously in VoiceClient.start(), before the socket opens or microphone permission resolves. This preserves browser user activation for strict autoplay policies. Surface a rejected unlock rather than silently accepting it. No provider credentials changed.

Final production validation (b0b71f6): normal browser settings with strict autoplay, software-renderer fallback automatically selected, 219 outgoing audio frames, correct spoken transcript, 53 received and scheduled reply audio chunks, output peak 0.9966 and both contexts running. No voice errors. All 48 focused tests, TypeScript and frontend/backend CI passed.
