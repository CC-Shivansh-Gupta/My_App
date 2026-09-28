#!/usr/bin/env python3
"""Jarvis laptop companion: always listening for "Hey Jarvis", even with the browser in the
background or the screen off, using only free, open-weights models that run on your computer.

  wake word  openWakeWord ("hey_jarvis" model, bundled with it)
  hearing    faster-whisper (Whisper, on the CPU)
  voice      Piper (a natural open voice), or your system's voice if Piper isn't set up

It does no thinking itself. What you say goes to the Daybook tab open in your browser over a
WebSocket on 127.0.0.1, where Jarvis runs it with all your data (rules, memory, protocols, your
AI brain). The reply comes back a sentence at a time and is spoken here. If no Daybook tab is
open, it opens one with the request in the URL.

  pip install -r requirements.txt
  python jarvis_companion.py                       # listen for "Hey Jarvis"
  python jarvis_companion.py --text                # type instead of talking (no mic needed)
  python jarvis_companion.py --piper-voice en_GB-alan-medium.onnx

Then in Daybook on this computer: Jarvis page → Laptop companion → On.
"""

import argparse
import asyncio
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import webbrowser

DEFAULT_URL = "https://cc-shivansh-gupta.github.io/My_App/"
SAMPLE_RATE = 16000
FRAME = 1280  # 80 ms, what openWakeWord expects


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---- The link to the Daybook tab -------------------------------------------------------------------------------
class Bridge:
    """A WebSocket server the Daybook tab connects to. Only the app's own origin may connect,
    so another website can't listen in on what you say."""

    def __init__(self, port, origins):
        self.port = port
        self.origins = origins
        self.clients = []  # newest last
        self.streams = {}  # request id -> asyncio.Queue of ('say'|'reply', payload)
        self.url_asks = asyncio.Queue()  # replies to requests that came in through ?ask=
        self.connected_event = asyncio.Event()

    async def serve(self):
        from websockets.asyncio.server import serve

        async def handler(ws):
            self.clients.append(ws)
            self.connected_event.set()
            log("Daybook connected")
            try:
                async for raw in ws:
                    self._receive(raw)
            finally:
                if ws in self.clients:
                    self.clients.remove(ws)
                if not self.clients:
                    self.connected_event.clear()
                log("Daybook disconnected")

        return await serve(handler, "127.0.0.1", self.port, origins=self.origins)

    def _receive(self, raw):
        try:
            m = json.loads(raw)
        except ValueError:
            return
        kind, rid = m.get("type"), str(m.get("id", ""))
        if kind == "hello":
            log(f"Talking to {m.get('name', 'Jarvis')}" + (f" for {m['user']}" if m.get("user") else ""))
            return
        if kind not in ("say", "reply"):
            return
        q = self.streams.get(rid)
        if q is None and rid.startswith("ask-"):
            q = self.url_asks
        if q is not None:
            q.put_nowait((kind, m))

    @property
    def connected(self):
        return bool(self.clients)

    async def send(self, msg):
        if not self.clients:
            return False
        try:
            await self.clients[-1].send(json.dumps(msg))
            return True
        except Exception:  # the tab went away mid-send
            return False

    async def ask(self, text, timeout=90):
        """Sends `text`; yields ('say', sentence) as they arrive, then ('reply', final)."""
        rid = f"c{int(time.time() * 1000)}"
        q = asyncio.Queue()
        self.streams[rid] = q
        try:
            if not await self.send({"type": "text", "id": rid, "text": text}):
                return
            while True:
                kind, m = await asyncio.wait_for(q.get(), timeout)
                yield kind, m
                if kind == "reply":
                    return
        finally:
            self.streams.pop(rid, None)


# ---- Speaking -------------------------------------------------------------------------------------------------------
class Voice:
    def __init__(self, piper_voice=None, mute=False):
        self.mute = mute
        self.piper = None
        self.system = None
        if mute:
            return
        if piper_voice:
            try:
                from piper import PiperVoice  # piper-tts

                self.piper = PiperVoice.load(piper_voice)
                log(f"Voice: Piper ({os.path.basename(piper_voice)})")
            except Exception as e:  # noqa: BLE001 - fall back to the system voice
                log(f"Piper unavailable ({e}); using the system voice")
        if not self.piper:
            if platform.system() == "Darwin" and shutil.which("say"):
                self.system = ["say", "-v", "Daniel"]
            elif platform.system() == "Windows":
                self.system = "sapi"
            elif shutil.which("espeak-ng") or shutil.which("espeak"):
                self.system = [shutil.which("espeak-ng") or shutil.which("espeak"), "-v", "en-gb"]
            elif shutil.which("spd-say"):
                self.system = ["spd-say", "-w"]

    def speak(self, text):
        """Blocking: returns when it has finished speaking."""
        text = text.strip()
        if not text or self.mute:
            return
        if self.piper:
            import wave

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                path = f.name
            try:
                with wave.open(path, "wb") as w:
                    make = getattr(self.piper, "synthesize_wav", None) or self.piper.synthesize  # piper-tts 1.3+ / 1.2
                    make(text, w)
                play_wav(path)
            finally:
                os.unlink(path)
            return
        if self.system == "sapi":
            ps = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($args[0])"
            subprocess.run(["powershell", "-NoProfile", "-Command", ps, text], check=False)
        elif self.system:
            subprocess.run([*self.system, text], check=False)


def play_wav(path):
    try:
        import sounddevice as sd
        import soundfile as sf

        data, rate = sf.read(path, dtype="float32")
        sd.play(data, rate)
        sd.wait()
        return
    except Exception:  # noqa: BLE001 - try the system player instead
        pass
    for cmd in (["afplay", path], ["aplay", "-q", path], ["paplay", path]):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, check=False)
            return


def chime(kind="wake"):
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError:
        return
    notes = {"wake": [(660, 0.09), (990, 0.14)], "done": [(880, 0.05), (1320, 0.09)], "error": [(440, 0.12), (311, 0.2)]}[kind]
    parts = []
    for f, d in notes:
        t = np.arange(int(SAMPLE_RATE * d)) / SAMPLE_RATE
        env = np.minimum(1, t / 0.01) * np.exp(-t / (d / 3))
        parts.append(0.18 * np.sin(2 * np.pi * f * t) * env)
    sd.play(np.concatenate(parts).astype("float32"), SAMPLE_RATE)
    sd.wait()


# ---- Hearing --------------------------------------------------------------------------------------------------------
class Ears:
    def __init__(self, whisper_model="base.en", threshold=0.5, device=None):
        import numpy as np
        import sounddevice as sd
        from faster_whisper import WhisperModel
        from openwakeword.model import Model

        self.np = np
        self.threshold = threshold
        log("Loading the wake word model…")
        try:
            self.oww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        except Exception:  # older openWakeWord needs the models downloaded first
            import openwakeword.utils

            openwakeword.utils.download_models(["hey_jarvis"])
            self.oww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        log(f"Loading Whisper ({whisper_model})…")
        self.whisper = WhisperModel(whisper_model, device="cpu", compute_type="int8")
        self.frames = asyncio.Queue()
        self.loop = asyncio.get_running_loop()
        self.stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME, device=device, callback=self._audio)
        self.stream.start()
        self.muted = False

    def _audio(self, data, frames, t, status):
        if not self.muted:
            self.loop.call_soon_threadsafe(self.frames.put_nowait, data[:, 0].copy())

    def drain(self):
        while not self.frames.empty():
            self.frames.get_nowait()

    async def wake(self):
        """Waits for "Hey Jarvis"."""
        self.oww.reset()
        self.drain()
        while True:
            frame = await self.frames.get()
            scores = self.oww.predict(frame)
            if max(scores.values(), default=0) >= self.threshold:
                return

    async def utterance(self, max_s=15.0, silence_s=1.2, start_timeout=6.0):
        """Records until you pause. Returns int16 samples, or None if you said nothing."""
        np = self.np
        self.drain()
        chunks, floor, spoke, quiet_for, t = [], None, False, 0.0, 0.0
        step = FRAME / SAMPLE_RATE
        while t < max_s:
            frame = await self.frames.get()
            chunks.append(frame)
            t += step
            rms = float(np.sqrt(np.mean((frame.astype(np.float32) / 32768) ** 2)))
            if floor is None or t < 0.3:
                floor = rms if floor is None else max(floor, rms)
                continue
            if rms > max(0.012, floor * 2.5):
                spoke, quiet_for = True, 0.0
            elif spoke:
                quiet_for += step
                if quiet_for >= silence_s:
                    break
            elif t > start_timeout:
                return None
        return np.concatenate(chunks) if spoke else None

    def transcribe(self, samples):
        audio = samples.astype(self.np.float32) / 32768
        segments, _ = self.whisper.transcribe(audio, language="en", beam_size=1, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()


# ---- The conversation ------------------------------------------------------------------------------------------------
async def exchange(text, bridge, voice, loop, app_url, ears=None):
    """Sends one request and speaks the answer. Returns the final reply (or None)."""
    if not bridge.connected:
        log("No Daybook tab open; opening one…")
        webbrowser.open(f"{app_url}?ask={urllib.parse.quote(text)}")
        try:
            kind, m = None, None
            while kind != "reply":
                kind, m = await asyncio.wait_for(bridge.url_asks.get(), 45)
                if kind == "say":
                    await speak(voice, m.get("text", ""), loop, ears)
            return m
        except asyncio.TimeoutError:
            log("The tab didn't answer. Is the companion switched on in Daybook (Jarvis page) on this computer?")
            return None
    final = None
    async for kind, m in bridge.ask(text):
        if kind == "say":
            log("Jarvis:", m.get("text", ""))
            await speak(voice, m.get("text", ""), loop, ears)
        else:
            final = m
            if m.get("title") and m.get("title") != m.get("say"):
                log("  ↳", m["title"])
    return final


async def speak(voice, text, loop, ears=None):
    if ears:
        ears.muted = True  # don't hear ourselves
    try:
        await loop.run_in_executor(None, voice.speak, text)
    finally:
        if ears:
            ears.muted = False


async def listen_loop(bridge, voice, args):
    loop = asyncio.get_running_loop()
    ears = Ears(args.whisper, args.threshold, args.device)
    log('Ready. Say "Hey Jarvis".')
    while True:
        await ears.wake()
        log("Wake word")
        await bridge.send({"type": "wake"})
        await loop.run_in_executor(None, chime, "wake")
        follow = True
        while follow:
            samples = await ears.utterance()
            if samples is None:
                await bridge.send({"type": "idle"})
                break
            await bridge.send({"type": "thinking"})
            text = await loop.run_in_executor(None, ears.transcribe, samples)
            if not text:
                await bridge.send({"type": "idle"})
                break
            log("You:", text)
            reply = await exchange(text, bridge, voice, loop, args.url, ears)
            # Keep listening after a question, or in conversation mode until it's told "thanks".
            follow = bool(reply) and not reply.get("end") and (reply.get("ask") or args.conversation)
            if follow:
                await bridge.send({"type": "listening"})
                await loop.run_in_executor(None, chime, "wake")


async def text_loop(bridge, voice, args):
    loop = asyncio.get_running_loop()
    log("Type to Jarvis (Ctrl+D to quit).")
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            return
        line = line.strip()
        if line:
            reply = await exchange(line, bridge, voice, loop, args.url)
            if reply is None and not bridge.connected:
                log("(no reply)")


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=DEFAULT_URL, help="your Daybook address (default: %(default)s)")
    p.add_argument("--port", type=int, default=8765, help="local port the Daybook tab connects to")
    p.add_argument("--allow-origin", action="append", default=[], help="another origin allowed to connect (e.g. http://localhost:8080)")
    p.add_argument("--text", action="store_true", help="type requests instead of talking")
    p.add_argument("--mute", action="store_true", help="print replies instead of speaking them")
    p.add_argument("--piper-voice", help="path to a Piper voice (.onnx), e.g. en_GB-alan-medium.onnx")
    p.add_argument("--whisper", default="base.en", help="Whisper model: tiny.en, base.en, small.en… (default: %(default)s)")
    p.add_argument("--threshold", type=float, default=0.5, help="wake word sensitivity, 0-1; lower hears more (default: %(default)s)")
    p.add_argument("--device", default=None, help="microphone name or index (see: python -m sounddevice)")
    p.add_argument("--no-conversation", dest="conversation", action="store_false", help="don't keep listening after each reply")
    args = p.parse_args()

    u = urllib.parse.urlsplit(args.url)
    origins = [f"{u.scheme}://{u.netloc}", "http://localhost:8080", "http://127.0.0.1:8080", *args.allow_origin]
    bridge = Bridge(args.port, origins)
    server = await bridge.serve()
    log(f"Waiting for Daybook on ws://127.0.0.1:{args.port} (allowed: {', '.join(origins)})")
    voice = Voice(args.piper_voice, mute=args.mute)
    try:
        await (text_loop(bridge, voice, args) if args.text else listen_loop(bridge, voice, args))
    finally:
        server.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
