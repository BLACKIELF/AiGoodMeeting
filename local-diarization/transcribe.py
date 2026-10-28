#!/usr/bin/env python3
"""Offline Nemotron diarization + whisper.cpp short-token alignment.

stdout is a single schema_version=1 JSON document on success. All model and
subprocess output is redirected to stderr or private temporary files.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import mmap
import os
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import wave
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16000
FRAME_SECONDS = 0.01
ASR_CHUNK_SECONDS = 120
ASR_CONTEXT_SECONDS = 2


class Cancelled(Exception):
    def __init__(self, signum: int):
        self.signum = signum


class ProcessOwner:
    """Only signal subprocess groups created by this invocation."""

    def __init__(self):
        self.children: set[subprocess.Popen] = set()
        self.handlers = {}

    def __enter__(self):
        for signum in (signal.SIGTERM, signal.SIGINT):
            self.handlers[signum] = signal.signal(signum, self.cancel)
        return self

    def cancel(self, signum, _frame):
        for child in tuple(self.children):
            self._signal(child, signal.SIGTERM)
        raise Cancelled(signum)

    @staticmethod
    def _signal(child, signum):
        if child.poll() is None:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

    def close(self):
        children = tuple(self.children)
        for child in children:
            self._signal(child, signal.SIGTERM)
        deadline = time.monotonic() + 2
        for child in children:
            try:
                child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                self._signal(child, signal.SIGKILL)
                child.wait()
        self.children.clear()

    def __exit__(self, *_exc):
        # A second cancel must not interrupt subprocess/tempfile cleanup.
        for signum in self.handlers:
            signal.signal(signum, signal.SIG_IGN)
        self.close()
        for signum, handler in self.handlers.items():
            signal.signal(signum, handler)

    def run(self, command: list[str], log_path: Path):
        with log_path.open("wb") as log:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            self.children.add(child)
            try:
                while True:
                    try:
                        code = child.wait(timeout=0.2)
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                # Leave an interrupted child registered for __exit__ to reap.
                if child.poll() is not None:
                    self.children.discard(child)
        if code:
            tail = log_path.read_bytes()[-4000:].decode("utf-8", errors="replace")
            raise RuntimeError(f"{Path(command[0]).name} 运行失败（{code}）：{tail.strip()}")


@contextlib.contextmanager
def diagnostic_stdout():
    """Catch native-library printf as well as Python print."""
    sys.stdout.flush()
    original = os.dup(1)
    try:
        os.dup2(2, 1)
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        sys.stderr.flush()
        os.dup2(original, 1)
        os.close(original)


@dataclass
class TimedText:
    start: float
    end: float
    text: str
    uncertain: bool = False


def punctuation(text: str) -> bool:
    return bool(text) and all(c.isspace() or unicodedata.category(c).startswith("P") for c in text)


def offsets(item: dict) -> tuple[float, float] | None:
    value = item.get("offsets", {})
    try:
        start, end = float(value["from"]) / 1000, float(value["to"]) / 1000
    except (KeyError, TypeError, ValueError):
        return None
    if not (math.isfinite(start) and math.isfinite(end) and 0 <= start <= end):
        return None
    return start, end


def short_context(units: list[TimedText], warnings: Counter) -> list[TimedText]:
    """Keep zero-duration lexical tokens in a nearby <=1.5 s measured span.

    This does not invent evenly spaced word times. If no short measured neighbor
    exists, keep a 10 ms timestamp bin, explicitly unknown.
    """
    result: list[TimedText] = []
    pending: list[TimedText] = []

    def flush_pending(next_unit=None):
        if not pending:
            return next_unit
        text = "".join(x.text for x in pending)
        start, end = pending[0].start, pending[-1].end
        warnings["zero_time"] += len(pending)
        if next_unit and 0 <= next_unit.start - end <= 0.35 and next_unit.end - start <= 1.5:
            next_unit = TimedText(start, next_unit.end, text + next_unit.text, next_unit.uncertain)
        elif result and 0 <= start - result[-1].end <= 0.35 and end - result[-1].start <= 1.5:
            result[-1].text += text
            result[-1].end = max(result[-1].end, end + FRAME_SECONDS)
        else:
            result.append(TimedText(start, max(start + FRAME_SECONDS, end), text, True))
        pending.clear()
        return next_unit

    for unit in units:
        if unit.end <= unit.start:
            pending.append(unit)
        else:
            unit = flush_pending(unit)
            result.append(unit)
    flush_pending()
    return result


def parse_whisper(document: dict, audio_duration: float, warnings: Counter) -> list[TimedText]:
    """Read genuine token offsets; a coarse sentence is never forced to one ID."""
    transcription = document.get("transcription")
    if not isinstance(transcription, list):
        raise RuntimeError("Whisper 输出缺少 transcription 列表")
    all_units = []
    for segment in transcription:
        text = segment.get("text", "")
        if not isinstance(text, str):
            raise RuntimeError("Whisper 输出含无效正文")
        if not text.strip():
            continue
        span = offsets(segment)
        if span is None:
            raise RuntimeError("Whisper 正文缺少可用时间范围")
        start, end = span
        tokens = [t for t in segment.get("tokens", []) if isinstance(t, dict)
                  and isinstance(t.get("text"), str)
                  and not (t.get("id", 0) >= 50257 and t["text"].startswith(("[_", "<|")))]
        measured = []
        valid = bool(tokens) and "".join(t["text"] for t in tokens) == text
        last_start = -1.0
        timings = [offsets(token) for token in tokens]
        for index, token in enumerate(tokens):
            timing = offsets(token)
            uncertain = False
            if timing is None and any(t is not None for t in timings):
                # whisper.cpp occasionally gives one token an end before its
                # start. Keep only that token unknown at its measured onset;
                # the remaining, correctly timed words stay usable.
                try:
                    anchor = float(token.get("offsets", {})["from"]) / 1000
                except (KeyError, TypeError, ValueError):
                    anchor = math.nan
                if math.isfinite(anchor) and max(0, last_start) <= anchor < audio_duration:
                    timing = (anchor, min(audio_duration, anchor + FRAME_SECONDS))
                    uncertain = True
                else:
                    left = measured[-1].end if measured else start
                    right = next((t[0] for t in timings[index + 1:] if t is not None), end)
                    if 0 <= right - left <= 1.5:
                        timing = (left, min(audio_duration, max(left + FRAME_SECONDS, right)))
                        uncertain = True
                if timing is not None:
                    warnings["coarse_time"] += 1
            if timing is None or timing[0] < last_start or timing[1] > audio_duration + 0.1:
                valid = False
                break
            last_start = timing[0]
            measured.append(TimedText(*timing, token["text"], uncertain or timing[1] - timing[0] > 2.5))
        if valid:
            for unit in measured:
                if unit.end - unit.start > 2.5:
                    warnings["coarse_time"] += 1
            all_units.extend(short_context(measured, warnings))
        else:
            # Preserve every recognized character when token timing is absent or
            # malformed. Retaining unknown is safer than voting over 30 seconds.
            warnings["coarse_time"] += 1
            all_units.append(TimedText(start, max(end, start + FRAME_SECONDS), text, True))
    for unit in all_units:
        unit.start = min(audio_duration, unit.start)
        unit.end = min(audio_duration, max(unit.start + FRAME_SECONDS, unit.end))
        if unit.end <= unit.start:
            raise RuntimeError("Whisper 时间超出音频长度，无法保留可靠结果")
    if any(b.start < a.start for a, b in zip(all_units, all_units[1:])):
        raise RuntimeError("Whisper 时间顺序异常，无法安全对齐")
    return all_units


class ProbabilityTimeline:
    """Memory-map 10 ms model scores, without retaining a recording in RAM."""

    def __init__(self, path: Path, speakers: int, frame_seconds: float = FRAME_SECONDS):
        self.speakers = speakers
        self.frame_seconds = frame_seconds
        self.file = path.open("rb")
        self.size = path.stat().st_size
        if not self.size or self.size % (speakers * 4):
            self.file.close()
            raise RuntimeError("分人模型没有输出完整的时间序列")
        self.frames = self.size // (speakers * 4)
        self.data = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)
        self.format = struct.Struct("<" + "f" * speakers)

    def close(self):
        self.data.close()
        self.file.close()

    def classify(self, start: float, end: float) -> tuple[str, str | None]:
        duration = end - start
        sums = [0.0] * self.speakers
        active = [0.0] * self.speakers
        overlap = 0.0
        for index in range(max(0, math.floor(start / self.frame_seconds)),
                           min(self.frames, math.ceil(end / self.frame_seconds))):
            weight = max(0.0, min(end, (index + 1) * self.frame_seconds) - max(start, index * self.frame_seconds))
            values = self.format.unpack_from(self.data, index * self.format.size)
            count = 0
            for speaker, value in enumerate(values):
                if not math.isfinite(value) or not 0 <= value <= 1:
                    raise RuntimeError("分人模型输出含无效概率")
                sums[speaker] += weight * value
                if value >= 0.5:
                    active[speaker] += weight
                    count += 1
            if count >= 2:
                overlap += weight
        ranking = sorted(range(self.speakers), key=lambda s: sums[s], reverse=True)
        winner = ranking[0]
        runner = sums[ranking[1]] if self.speakers > 1 else 0.0
        if overlap / duration >= 0.2:
            return "unknown", "overlap"
        if sums[winner] / duration < 0.45 or active[winner] / duration < 0.35:
            return "unknown", "low_confidence"
        if (sums[winner] - runner) / duration < 0.15:
            return "unknown", "boundary"
        return f"speaker_{winner}", None


def align(units: list[TimedText], timeline: ProbabilityTimeline, warnings: Counter) -> list[dict]:
    segments = []
    for unit in units:
        if unit.uncertain:
            speaker, reason = "unknown", "time_unknown"
        elif punctuation(unit.text) and segments and unit.start - segments[-1]["end"] <= 0.5:
            speaker, reason = segments[-1]["speaker"], None
        else:
            speaker, reason = timeline.classify(unit.start, unit.end)
        if reason:
            warnings[reason] += 1
        # Group only adjacent tokens already assigned individually. This avoids
        # assigning a long ASR sentence to its dominant speaker.
        if (segments and segments[-1]["speaker"] == speaker
                and unit.start - segments[-1]["end"] <= 0.6
                and unit.end - segments[-1]["start"] <= 12):
            segments[-1]["end"] = max(segments[-1]["end"], unit.end)
            segments[-1]["text"] += unit.text
        else:
            segments.append({"start": unit.start, "end": unit.end, "speaker": speaker, "text": unit.text})
    for segment in segments:
        segment["start"] = math.floor(segment["start"] * 1000) / 1000
        segment["end"] = math.ceil(segment["end"] * 1000) / 1000
    segments.sort(key=lambda segment: segment["start"])
    return segments


def wav_chunks(path: Path):
    import numpy as np
    with wave.open(str(path), "rb") as audio:
        while raw := audio.readframes(SAMPLE_RATE * 5):
            yield np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def sortformer_windows(path: Path, model):
    """Bounded file mode matching upstream global-STFT/AOSC semantics.

    Do not call Sortformer's raw-PCM feed on arbitrary five-second pieces: its
    rounded 80 ms frame count accumulates timestamp drift. Global mel indices,
    two-frame STFT halos and right-context embeddings avoid that drift.
    """
    import mlx.core as mx
    import numpy as np
    from mlx_audio.vad.models.sortformer.sortformer import extract_mel_features
    proc = model._processor_config
    config = model.config.modules_config
    factor = model.config.fc_encoder_config.subsampling_factor
    central = config.chunk_len * factor
    right = config.chunk_right_context * factor
    state = model.init_streaming_state()
    with wave.open(str(path), "rb") as audio:
        total_samples = audio.getnframes()
        # Centered STFT has one final frame, just as upstream file mode does.
        total_mels = total_samples // proc.hop_length + 1
        for start in range(0, total_mels, central):
            count = min(central, total_mels - start)
            feature_count = min(count + right, total_mels - start)
            first_sample = max(0, (start - 2) * proc.hop_length)
            last_sample = min(total_samples, (start + feature_count + 2) * proc.hop_length)
            audio.setpos(first_sample)
            raw = audio.readframes(last_sample - first_sample)
            waveform = mx.array(np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0)
            features = extract_mel_features(waveform, sample_rate=proc.sampling_rate,
                                           n_fft=proc.n_fft, hop_length=proc.hop_length,
                                           win_length=proc.win_length, n_mels=proc.feature_size,
                                           preemphasis_coeff=proc.preemphasis, normalize=None, pad_to=0)
            local_start = start - first_sample // proc.hop_length
            features = features[:, :, local_start:local_start + feature_count]
            mx.eval(features)
            right_context = None
            if right and feature_count > count:
                pre_encoded, _ = model.fc_encoder.pre_encode(features, mx.array([feature_count]))
                central_frames = (count + factor - 1) // factor
                right_context = pre_encoded[:, central_frames:central_frames + config.chunk_right_context, :]
                mx.eval(right_context)
            predictions, state = model.streaming_step(features[:, :, :count], mx.array([count]), state,
                                                      right_context_embs=right_context)
            yield predictions
            state = model._maybe_compress_state(state, config.spkcache_len,
                                                config.fifo_len if config.fifo_len > 0 else 188,
                                                config)


def diarize(path: Path, model_path: Path, probability_path: Path) -> tuple[int, int, float, str]:
    import numpy as np
    from mlx_audio.vad import load
    config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    model_type = config.get("model_type")
    speakers = config.get("num_speakers")
    if not ((model_type == "nemotron_diarization" and speakers == 8)
            or (model_type == "sortformer" and speakers == 4 and config.get("modules_config", {}).get("use_aosc"))):
        raise RuntimeError("需要 Nemotron 八人或 Sortformer v2.1 四人本地模型目录")
    model = load(str(model_path), strict=True)
    processor = config["processor_config"]
    if processor["sampling_rate"] != SAMPLE_RATE:
        raise RuntimeError("分人模型采样率与运行时不匹配")
    if model_type == "nemotron_diarization":
        frame_seconds = processor["hop_length"] * config.get("output_subsampling_factor", 1) / SAMPLE_RATE
        predictions = (r.speaker_probs for r in model.generate_stream(wav_chunks(path), threshold=0.5, verbose=False))
        name = "mlx-community/Nemotron-3-Diarization"
    else:
        frame_seconds = processor["hop_length"] * config["fc_encoder_config"]["subsampling_factor"] / SAMPLE_RATE
        predictions = sortformer_windows(path, model)
        name = "mlx-community/diar_streaming_sortformer_4spk-v2.1-" + ("fp32" if config.get("dtype") == "float32" else "fp16")
    overlap_frames = 0
    with probability_path.open("wb") as output:
        for prediction in predictions:
            values = np.asarray(prediction, dtype="<f4")
            if values.ndim != 2 or values.shape[1] != speakers:
                raise RuntimeError("分人模型输出形状异常")
            overlap_frames += int(np.sum(np.sum(values >= 0.5, axis=1) >= 2))
            values.tofile(output)
    return speakers, round(overlap_frames * frame_seconds * 1000), frame_seconds, name


def write_window(source: Path, destination: Path, first: int, last: int):
    with wave.open(str(source), "rb") as audio, wave.open(str(destination), "wb") as chunk:
        chunk.setparams(audio.getparams())
        audio.setpos(first)
        remaining = last - first
        while remaining:
            count = min(remaining, SAMPLE_RATE * 5)
            data = audio.readframes(count)
            if not data:
                raise RuntimeError("读取音频分块时提前结束")
            chunk.writeframesraw(data)
            remaining -= len(data) // 2


def transcribe(path: Path, args, temporary: Path, owner: ProcessOwner, warnings: Counter):
    with wave.open(str(path), "rb") as audio:
        total_frames = audio.getnframes()
    duration = total_frames / SAMPLE_RATE
    units = []
    chunk_frames = SAMPLE_RATE * ASR_CHUNK_SECONDS
    context_frames = SAMPLE_RATE * ASR_CONTEXT_SECONDS
    chunks = math.ceil(total_frames / chunk_frames)
    if chunks > 1:
        warnings["chunks"] = chunks
    for index, first in enumerate(range(0, total_frames, chunk_frames)):
        last = min(total_frames, first + chunk_frames)
        window_first = max(0, first - context_frames)
        window_last = min(total_frames, last + context_frames)
        window_path = temporary / "asr-window.wav"
        output_base = temporary / "whisper"
        write_window(path, window_path, window_first, window_last)
        print(f"转写进度：{index + 1}/{chunks}", file=sys.stderr, flush=True)
        command = [str(args.whisper_cli), "-m", str(args.whisper_model), "-f", str(window_path),
                   "-l", args.language, "-ojf", "-ml", "0", "-of", str(output_base), "-np"]
        owner.run(command, temporary / "whisper.log")
        output_path = output_base.with_suffix(".json")
        if not output_path.is_file():
            raise RuntimeError("Whisper 未生成转写文件")
        document = json.loads(output_path.read_text(encoding="utf-8"))
        local_units = parse_whisper(document, (window_last - window_first) / SAMPLE_RATE, warnings)
        offset = window_first / SAMPLE_RATE
        for unit in local_units:
            unit.start += offset
            unit.end += offset
            midpoint = (unit.start + unit.end) / 2
            if first / SAMPLE_RATE <= midpoint < last / SAMPLE_RATE:
                units.append(unit)
        output_path.unlink()
    if not units:
        raise RuntimeError("音频未取得可用转写，请检查是否有清晰讲话")
    return units, duration


def warning_messages(counts: Counter, duration: float, speakers: list[str], capacity: int = 8) -> list[str]:
    messages = []
    if counts["overlap"] or counts["model_overlap_ms"] >= 100:
        overlap_seconds = counts["model_overlap_ms"] / 1000
        messages.append(f"检测到多人重叠（约 {overlap_seconds:.2f} 秒），{counts['overlap']} 个对应短片段已标为“未确定说话人”；同时讲话的每个人的完整内容仍需人工核对。")
    uncertain = counts["low_confidence"] + counts["boundary"] + counts["time_unknown"]
    if uncertain:
        messages.append(f"{uncertain} 个短片段的说话人或时间无法确定，已保留文字并标为“未确定说话人”。")
    if counts["zero_time"]:
        messages.append(f"有 {counts['zero_time']} 处词语缺少独立时间点，已使用相邻短片段的时间或标为“未确定说话人”；这些时间为近似值。")
    if counts["coarse_time"]:
        messages.append(f"有 {counts['coarse_time']} 处缺少细致时间信息，已保留原文并标为“未确定说话人”。")
    if counts["chunks"]:
        messages.append("长录音按两分钟分段处理，前后各参考两秒内容；分段衔接处请复核。")
    if duration < 10:
        messages.append("录音不足十秒，说话人分组可能不稳定。")
    if len([s for s in speakers if s != "unknown"]) >= capacity:
        messages.append(f"已达到 {capacity} 位说话人的处理上限，更多声音可能被合并。")
    return messages


def absolute_file(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        raise argparse.ArgumentTypeError("需要现有文件的绝对路径")
    return path


def absolute_directory(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or not path.is_dir():
        raise argparse.ArgumentTypeError("需要现有模型目录的绝对路径")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="离线中文转写与匿名说话人分组")
    parser.add_argument("--audio", required=True, type=absolute_file)
    parser.add_argument("--whisper-model", required=True, type=absolute_file)
    parser.add_argument("--diarization-model", required=True, type=absolute_directory)
    parser.add_argument("--whisper-cli", required=True, type=absolute_file)
    parser.add_argument("--ffmpeg", required=True, type=absolute_file)
    parser.add_argument("--language", choices=("zh", "auto"), default="zh")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        # Reap owned processes before removing their input and log files.
        with tempfile.TemporaryDirectory(prefix="meetily-diarization-") as scratch:
            with ProcessOwner() as owner:
                temporary = Path(scratch)
                normalized = temporary / "audio.wav"
                with diagnostic_stdout():
                    owner.run([str(args.ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error",
                               "-i", str(args.audio), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
                               "-c:a", "pcm_s16le", str(normalized)], temporary / "ffmpeg.log")
                    with wave.open(str(normalized), "rb") as audio:
                        duration = audio.getnframes() / audio.getframerate()
                    if duration < FRAME_SECONDS:
                        raise RuntimeError("音频过短，无法取得可用时间范围")
                    print("开始本地说话人分组", file=sys.stderr, flush=True)
                    probability_path = temporary / "speaker-probabilities.f32"
                    count, overlap_ms, frame_seconds, model_name = diarize(normalized, args.diarization_model, probability_path)
                    counts = Counter()
                    counts["model_overlap_ms"] = overlap_ms
                    units, duration = transcribe(normalized, args, temporary, owner, counts)
                    timeline = ProbabilityTimeline(probability_path, count, frame_seconds)
                    try:
                        segments = align(units, timeline, counts)
                    finally:
                        timeline.close()
                speakers = sorted({s["speaker"] for s in segments if s["speaker"] != "unknown"}, key=lambda s: int(s.split("_")[1]))
                if any(s["speaker"] == "unknown" for s in segments):
                    speakers.append("unknown")
                result = {"schema_version": 1, "model": model_name, "segments": segments,
                          "speakers": speakers, "warnings": warning_messages(counts, duration, speakers, count)}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 0
    except Cancelled as error:
        print("已取消本地分人转写", file=sys.stderr)
        return 128 + error.signum
    except Exception as error:
        print(f"本地分人转写失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
