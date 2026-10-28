import json
import math
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transcribe import ProbabilityTimeline, TimedText, align, parse_whisper, warning_messages


def token(text, start, end):
    return {"text": text, "offsets": {"from": start * 1000, "to": end * 1000}, "id": 1}


def document(text, tokens, end=30):
    return {"transcription": [{"text": text, "tokens": tokens, "offsets": {"from": 0, "to": end * 1000}}]}


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.path = Path(self.scratch.name) / "probs.f32"

    def timeline(self, frames, frame_seconds=0.01):
        with self.path.open("wb") as stream:
            for row in frames:
                stream.write(struct.pack("<ff", *row))
        timeline = ProbabilityTimeline(self.path, 2, frame_seconds)
        self.addCleanup(timeline.close)
        return timeline

    def test_speaker_change_inside_single_thirty_second_asr_sentence(self):
        counts = Counter()
        units = parse_whisper(document("甲先说。乙回答。", [token("甲先说。", 1, 2), token("乙回答。", 16, 17)]), 30, counts)
        timeline = self.timeline([(0.95, 0.01)] * 1500 + [(0.01, 0.95)] * 1500)
        result = align(units, timeline, counts)
        self.assertEqual([x["speaker"] for x in result], ["speaker_0", "speaker_1"])
        self.assertEqual([(x["start"], x["end"]) for x in result], [(1.0, 2.0), (16.0, 17.0)])
        self.assertEqual("".join(x["text"] for x in result), "甲先说。乙回答。")

    def test_native_eighty_millisecond_model_timeline_uses_real_seconds(self):
        counts = Counter()
        timeline = self.timeline([(0.95, 0.01)] * 10 + [(0.01, 0.95)] * 10, 0.08)
        result = align([TimedText(0.6, 0.7, "甲"), TimedText(0.9, 1.0, "乙")], timeline, counts)
        self.assertEqual([s["speaker"] for s in result], ["speaker_0", "speaker_1"])

    def test_missing_token_timing_retains_all_text_as_unknown(self):
        counts = Counter()
        units = parse_whisper(document("不能默默丢掉这句话", [{"text": "不能默默丢掉这句话", "id": 1}]), 30, counts)
        result = align(units, self.timeline([(0.99, 0.01)] * 3000), counts)
        self.assertEqual(result[0]["text"], "不能默默丢掉这句话")
        self.assertEqual(result[0]["speaker"], "unknown")
        self.assertEqual(counts["coarse_time"], 1)

    def test_overlap_is_unknown_and_does_not_duplicate_or_drop_words(self):
        counts = Counter()
        result = align([TimedText(0.1, 0.6, "重叠部分")], self.timeline([(0.9, 0.8)] * 100), counts)
        self.assertEqual(result, [{"start": 0.1, "end": 0.6, "speaker": "unknown", "text": "重叠部分"}])
        self.assertEqual(counts["overlap"], 1)
        self.assertIn("多人重叠", "".join(warning_messages(counts, 20, ["unknown"])))

    def test_equal_evidence_at_turn_boundary_is_not_forced_to_a_speaker(self):
        counts = Counter()
        timeline = self.timeline([(0.95, 0.01)] * 50 + [(0.01, 0.95)] * 50)
        result = align([TimedText(0.3, 0.7, "交界词")], timeline, counts)
        self.assertEqual(result[0]["speaker"], "unknown")
        self.assertEqual(counts["boundary"], 1)

    def test_zero_duration_tokens_only_use_short_measured_neighbor(self):
        counts = Counter()
        units = parse_whisper(document("大家好，我们开始", [token("大家好", 0.6, 0.6), token("，", 0.6, 0.7), token("我们开始", 0.7, 1.4)], 2), 2, counts)
        self.assertEqual("".join(x.text for x in units), "大家好，我们开始")
        self.assertEqual((units[0].start, units[0].end), (0.6, 0.7))
        self.assertFalse(units[0].uncertain)
        self.assertEqual(counts["zero_time"], 1)
        self.assertTrue(all(u.end > u.start for u in units))

    def test_isolated_zero_duration_word_is_preserved_unknown(self):
        counts = Counter()
        units = parse_whisper(document("未知", [token("未知", 0.6, 0.6)], 1), 1, counts)
        result = align(units, self.timeline([(0.99, 0.01)] * 100), counts)
        self.assertEqual(result[0]["speaker"], "unknown")
        self.assertEqual(result[0]["text"], "未知")
        self.assertAlmostEqual(result[0]["end"] - result[0]["start"], 0.01)

    def test_silence_keeps_recognized_text_but_has_no_invented_speaker(self):
        counts = Counter()
        result = align([TimedText(0.1, 0.5, "待复核")], self.timeline([(0.01, 0.02)] * 100), counts)
        self.assertEqual(result[0]["speaker"], "unknown")
        self.assertEqual(result[0]["text"], "待复核")

    def test_invalid_probability_fails_instead_of_success(self):
        timeline = self.timeline([(math.nan, 0.5)] * 100)
        with self.assertRaisesRegex(RuntimeError, "无效概率"):
            timeline.classify(0.1, 0.5)

    def test_submillisecond_final_span_does_not_round_to_zero_length(self):
        counts = Counter()
        result = align([TimedText(0.9998, 0.9999, "末字", True)], self.timeline([(0.99, 0.01)] * 100), counts)
        self.assertGreater(result[0]["end"], result[0]["start"])

    def test_nonmonotonic_token_offsets_preserve_sentence_unknown(self):
        counts = Counter()
        units = parse_whisper(document("前后", [token("前", 2, 3), token("后", 1, 2)], 4), 4, counts)
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0].text, "前后")
        self.assertTrue(units[0].uncertain)

    def test_one_reversed_token_does_not_discard_other_timed_words(self):
        counts = Counter()
        units = parse_whisper(document("没有问题", [token("没有", 0.6, 0.4), token("问题", 0.6, 0.9)], 1), 1, counts)
        result = align(units, self.timeline([(0.01, 0.99)] * 100), counts)
        self.assertEqual([s["speaker"] for s in result], ["unknown", "speaker_1"])
        self.assertEqual("".join(s["text"] for s in result), "没有问题")
        self.assertEqual(counts["coarse_time"], 1)

    def test_product_warnings_use_plain_chinese_and_keep_counts(self):
        counts = Counter(overlap=2, model_overlap_ms=480, low_confidence=3,
                         zero_time=18, coarse_time=1, chunks=2)
        messages = warning_messages(counts, 131, ["speaker_0", "unknown"], 4)
        joined = "".join(messages)
        self.assertNotIn("unknown", joined)
        self.assertNotIn("Whisper", joined)
        self.assertIn("未确定说话人", joined)
        self.assertIn("18", joined)
        self.assertIn("0.48", joined)


class CancellationTests(unittest.TestCase):
    def test_sigterm_reaps_owned_child_and_removes_temporary_files(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            runner_code = """
import os,signal,sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from transcribe import ProcessOwner,Cancelled
root=Path(sys.argv[2])
try:
    with tempfile.TemporaryDirectory(dir=root,prefix='owned-') as work:
        (root/'work-path').write_text(work)
        with ProcessOwner() as owner:
            code=\"import os,signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(60)\"
            owner.run([sys.executable,'-c',code,str(root/'child-pid')],Path(work)/'log')
except Cancelled as error:
    raise SystemExit(128+error.signum)
"""
            unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
            runner = subprocess.Popen([sys.executable, "-c", runner_code, str(Path(__file__).resolve().parents[1]), str(root)])
            try:
                deadline = time.monotonic() + 5
                while not (root / "child-pid").exists() and time.monotonic() < deadline:
                    time.sleep(0.03)
                self.assertTrue((root / "child-pid").is_file())
                child_pid = int((root / "child-pid").read_text())
                runner.send_signal(signal.SIGTERM)
                self.assertEqual(runner.wait(timeout=6), 143)
                with self.assertRaises(ProcessLookupError):
                    import os
                    os.kill(child_pid, 0)
                self.assertFalse(Path((root / "work-path").read_text()).exists())
                self.assertIsNone(unrelated.poll())
            finally:
                if runner.poll() is None:
                    runner.kill()
                    runner.wait()
                unrelated.terminate()
                unrelated.wait()


if __name__ == "__main__":
    unittest.main()
