#!/usr/bin/env python3
"""Build a public, synthetic Chinese fixture from installed macOS voices."""
import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

TURNS = [
    ("Tingting", "甲", "大家好，我们今天讨论会议记录。请先确认录音清楚，然后介绍各自负责的工作。"),
    ("Grandpa (中文（中国大陆）)", "乙", "好的，我负责整理项目进度。本周已经完成第一轮测试，还需要检查两项问题。"),
    ("Tingting", "甲", "我听清楚了。接下来请把问题写进清单，明天下午我们一起确认处理结果。"),
    ("Grandpa (中文（中国大陆）)", "乙", "没有问题。我会在明天中午之前更新清单，并把测试结果带到会议上。"),
]
THREE_TURNS = [*TURNS[:2],
    ("Meijia", "丙", "我负责收集用户反馈。现在有三条建议，需要大家决定下一轮更新的优先顺序。"),
    *TURNS[2:],
    ("Meijia", "丙", "收到，我会把建议整理成表格。请大家补充自己的意见，明天一起讨论下一步工作。"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--three-voices", action="store_true")
    parser.add_argument("--third-voice", default="Meijia")
    parser.add_argument("--name")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sample_rate = 16000
    silence = bytes(int(0.6 * sample_rate) * 2)
    cursor = 0
    turns = []
    fixture_name = args.name or ("three-voices-zh" if args.three_voices else "two-voices-zh")
    turns_to_render = [(args.third_voice if speaker == "丙" else voice, speaker, text)
                       for voice, speaker, text in (THREE_TURNS if args.three_voices else TURNS)]
    with tempfile.TemporaryDirectory(prefix="meetily-fixture-") as scratch:
        with wave.open(str(args.output / f"{fixture_name}.wav"), "wb") as joined:
            joined.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
            for index, (voice, speaker, text) in enumerate(turns_to_render):
                aiff = Path(scratch) / f"{index}.aiff"
                wav = Path(scratch) / f"{index}.wav"
                subprocess.run(["/usr/bin/say", "-v", voice, "-r", "180", "-o", str(aiff), text], check=True)
                subprocess.run(["/opt/homebrew/bin/ffmpeg", "-nostdin", "-v", "error", "-i", str(aiff), "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(wav)], check=True)
                joined.writeframes(silence)
                cursor += len(silence) // 2
                with wave.open(str(wav), "rb") as source:
                    frames = source.readframes(source.getnframes())
                start = cursor / sample_rate
                joined.writeframes(frames)
                cursor += len(frames) // 2
                turns.append({"start": start, "end": cursor / sample_rate, "speaker": speaker, "voice": voice, "text": text})
            joined.writeframes(silence)
            cursor += len(silence) // 2
    metadata = {"synthetic": True, "source": "installed macOS say voices", "sample_rate": sample_rate, "duration": cursor / sample_rate, "turns": turns}
    (args.output / f"{fixture_name}.expected.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
