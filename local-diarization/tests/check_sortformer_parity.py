#!/usr/bin/env python3
"""Compare bounded adapter scores with official MLX Audio file-mode scores."""
import argparse
import json
import os
import sys
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    import numpy as np
    from mlx_audio.vad import load
    from transcribe import sortformer_windows
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    model = load(args.model, strict=True)
    chunk_seconds = model.config.modules_config.chunk_len * model.config.fc_encoder_config.subsampling_factor * model._processor_config.hop_length / model._processor_config.sampling_rate
    official = np.concatenate([np.asarray(result.speaker_probs) for result in model.generate_stream(args.audio, chunk_duration=chunk_seconds)])
    bounded = np.concatenate([np.asarray(prediction) for prediction in sortformer_windows(Path(args.audio), model)])
    error = np.abs(official - bounded)
    report = {"shape": list(bounded.shape), "chunk_seconds": chunk_seconds,
              "max_absolute_error": float(error.max()), "mean_absolute_error": float(error.mean()),
              "passed": bool(error.max() < 0.0005)}
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
