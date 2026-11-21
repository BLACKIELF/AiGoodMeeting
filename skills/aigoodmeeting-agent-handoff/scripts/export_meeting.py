#!/usr/bin/env python3
"""Read-only exporter for AiGoodMeeting local meetings (SQLite + speaker diarization)."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sqlite3
import sys
import urllib.parse
from typing import Any

APP_DATA_DIR = pathlib.Path.home() / "Library" / "Application Support" / "com.meetily.local-speakers"
DB_PATH = APP_DATA_DIR / "meeting_minutes.sqlite"
DIARIZATION_DIR = APP_DATA_DIR / "diarization"
BEIJING_TZ = dt.timezone(dt.timedelta(hours=8))


def open_readonly_db(db_path: pathlib.Path) -> sqlite3.Connection:
    if not db_path.is_file():
        raise FileNotFoundError(f"AiGoodMeeting database not found: {db_path}")
    uri = f"file:{urllib.parse.quote(str(db_path))}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def format_local_time(raw: str | None) -> str:
    if not raw:
        return "未知时间"
    cleaned = raw.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(cleaned)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(BEIJING_TZ).strftime("%Y-%m-%d %H:%M (UTC+8)")
    except ValueError:
        return raw


def format_mmss(seconds: float | None) -> str:
    if seconds is None:
        return ""
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    mins, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def load_diarization(meeting_id: str) -> dict[str, Any] | None:
    diar_path = DIARIZATION_DIR / f"{meeting_id}.json"
    if not diar_path.is_file():
        return None
    try:
        return json.loads(diar_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def extract_summary_markdown(raw_result: str | None) -> str:
    if not raw_result:
        return ""
    try:
        parsed = json.loads(raw_result)
        if isinstance(parsed, dict):
            md = parsed.get("markdown")
            if isinstance(md, str) and md.strip():
                return md.strip()
            eng = parsed.get("english_cache", {})
            if isinstance(eng, dict) and isinstance(eng.get("markdown"), str):
                return eng["markdown"].strip()
    except Exception:
        pass
    return raw_result.strip()


def list_meetings(conn: sqlite3.Connection, limit: int, as_json: bool) -> int:
    rows = conn.execute(
        """
        SELECT m.id, m.title, m.created_at, m.folder_path,
               (SELECT COUNT(*) FROM transcripts t WHERE t.meeting_id = m.id) AS transcript_count,
               (SELECT status FROM summary_processes sp WHERE sp.meeting_id = m.id) AS summary_status
        FROM meetings m
        ORDER BY m.created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    items = []
    for row in rows:
        diar = load_diarization(row["id"])
        items.append(
            {
                "id": row["id"],
                "title": row["title"],
                "created_at": row["created_at"],
                "local_time": format_local_time(row["created_at"]),
                "folder_path": row["folder_path"],
                "transcript_count": row["transcript_count"],
                "summary_status": row["summary_status"] or "none",
                "has_diarization": diar is not None,
            }
        )

    if as_json:
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return 0

    for idx, item in enumerate(items, 1):
        diar_tag = "已分人" if item["has_diarization"] else "未分人"
        print(
            f"{idx}. [{item['local_time']}] {item['title']}\n"
            f"   ID: {item['id']} | 转写: {item['transcript_count']} 段 | 纪要: {item['summary_status']} | {diar_tag}"
        )
        if item["folder_path"]:
            print(f"   目录: {item['folder_path']}")
    return 0


def find_meeting(conn: sqlite3.Connection, meeting_id: str | None, query: str | None) -> sqlite3.Row:
    if meeting_id:
        row = conn.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
        if not row:
            raise LookupError(f"Meeting not found: {meeting_id}")
        return row

    if query:
        like = f"%{query}%"
        row = conn.execute(
            """
            SELECT * FROM meetings
            WHERE title LIKE ? OR COALESCE(folder_path, '') LIKE ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (like, like),
        ).fetchone()
        if not row:
            raise LookupError(f"No meeting matched query: {query}")
        return row

    row = conn.execute("SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1").fetchone()
    if not row:
        raise LookupError("No meetings found in AiGoodMeeting database.")
    return row


def export_meeting(
    conn: sqlite3.Connection,
    meeting_id: str | None,
    query: str | None,
    output_path: str | None,
) -> int:
    meeting = find_meeting(conn, meeting_id, query)
    mid = meeting["id"]

    summary_row = conn.execute(
        "SELECT status, result FROM summary_processes WHERE meeting_id = ?",
        (mid,),
    ).fetchone()
    summary_md = extract_summary_markdown(summary_row["result"]) if summary_row else ""

    diar = load_diarization(mid)
    transcript_lines: list[str] = []

    if diar and isinstance(diar.get("segments"), list) and diar["segments"]:
        names: dict[str, str] = diar.get("names") or {}
        for seg in diar["segments"]:
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            spk_id = str(seg.get("speaker", "unknown"))
            spk = names.get(spk_id) or spk_id
            ts = format_mmss(seg.get("start"))
            prefix = f"[{ts}] " if ts else ""
            transcript_lines.append(f"{prefix}{spk}: {text}")
        transcript_source = "说话人分人稿（diarization）"
    else:
        rows = conn.execute(
            """
            SELECT audio_start_time, timestamp, speaker, transcript
            FROM transcripts
            WHERE meeting_id = ?
            ORDER BY COALESCE(audio_start_time, 1e18) ASC, rowid ASC
            """,
            (mid,),
        ).fetchall()
        for idx, row in enumerate(rows, 1):
            text = str(row["transcript"] or "").strip()
            if not text:
                continue
            ts = format_mmss(row["audio_start_time"])
            spk = str(row["speaker"] or "").strip()
            prefix_parts = []
            if ts:
                prefix_parts.append(f"[{ts}]")
            else:
                prefix_parts.append(f"[#{idx:03d}]")
            if spk:
                prefix_parts.append(f"{spk}:")
            transcript_lines.append(f"{' '.join(prefix_parts)} {text}")
        transcript_source = "原始转写（SQLite transcripts）"

    parts = [
        f"# 会议上下文：{meeting['title']}",
        "",
        "## 基本信息",
        f"- **会议 ID**：`{mid}`",
        f"- **记录时间**：{format_local_time(meeting['created_at'])}",
        f"- **录音目录**：`{meeting['folder_path'] or '无'}`",
        f"- **转写来源**：{transcript_source}（共 {len(transcript_lines)} 段）",
        "",
    ]

    if summary_md:
        parts.extend(
            [
                "## 本地纪要草稿（仅供参考，日期/人名/专有名词必须以下方原始转写为准）",
                "",
                summary_md,
                "",
            ]
        )

    parts.extend(
        [
            "## 完整转写原文",
            "",
            "\n".join(transcript_lines) if transcript_lines else "（无转写内容）",
            "",
        ]
    )

    content = "\n".join(parts)
    if output_path:
        out = pathlib.Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(content, encoding="utf-8")
        print(
            json.dumps(
                {
                    "ok": True,
                    "meeting_id": mid,
                    "title": meeting["title"],
                    "local_time": format_local_time(meeting["created_at"]),
                    "folder_path": meeting["folder_path"],
                    "segments": len(transcript_lines),
                    "output_path": str(out.resolve()),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(content)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Export AiGoodMeeting local meeting context")
    parser.add_argument("--db", default=str(DB_PATH), help="Path to meeting_minutes.sqlite")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List recent meetings")
    p_list.add_argument("--limit", type=int, default=15)
    p_list.add_argument("--json", action="store_true")

    p_exp = sub.add_parser("export", help="Export full meeting context markdown")
    p_exp.add_argument("--id", dest="meeting_id")
    p_exp.add_argument("--query", help="Substring match against title or folder path")
    p_exp.add_argument("--output", help="Write markdown to file instead of stdout")

    args = parser.parse_args()
    conn = open_readonly_db(pathlib.Path(args.db))
    try:
        if args.cmd == "list":
            return list_meetings(conn, args.limit, args.json)
        return export_meeting(conn, args.meeting_id, args.query, args.output)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
