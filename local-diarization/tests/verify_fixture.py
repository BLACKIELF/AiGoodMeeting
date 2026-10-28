#!/usr/bin/env python3
"""Check the actual runtime JSON against known synthetic voice turn intervals.

This checks anonymous grouping/coverage, not real-world diarization error rate.
"""
import argparse
import json
import math
from collections import Counter
from pathlib import Path


def verify(expected, actual):
    assert actual["schema_version"] == 1
    assert actual["segments"], "No transcription"
    declared = set(actual["speakers"])
    last = -1
    for segment in actual["segments"]:
        assert isinstance(segment["text"], str) and segment["text"]
        assert segment["speaker"] in declared
        assert math.isfinite(segment["start"]) and math.isfinite(segment["end"])
        assert 0 <= segment["start"] < segment["end"]
        assert segment["start"] >= last
        last = segment["start"]
    mapping = {}
    turns = []
    failures = []
    for index, turn in enumerate(expected["turns"]):
        scores = Counter()
        for segment in actual["segments"]:
            overlap = max(0, min(turn["end"], segment["end"]) - max(turn["start"], segment["start"]))
            if segment["speaker"] != "unknown":
                scores[segment["speaker"]] += overlap
        dominant, seconds = scores.most_common(1)[0] if scores else ("unknown", 0)
        coverage = seconds / (turn["end"] - turn["start"])
        if coverage < 0.5:
            failures.append(f"turn {index + 1}: known coverage below 50%")
        if turn["speaker"] in mapping and mapping[turn["speaker"]] != dominant:
            failures.append(f"turn {index + 1}: speaker identity changed")
        mapping.setdefault(turn["speaker"], dominant)
        turns.append({"turn": index + 1, "voice": turn.get("voice"), "expected_speaker": turn["speaker"],
                      "dominant_speaker": dominant, "known_coverage": round(coverage, 4)})
    if len(set(mapping.values())) != len(mapping):
        failures.append("different known voices were merged")
    return {"passed": not failures, "scope": "synthetic anonymous grouping; not a natural meeting benchmark",
            "speaker_mapping": mapping, "turns": turns, "failures": failures}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--actual", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    result = verify(json.loads(args.expected.read_text()), json.loads(args.actual.read_text()))
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
