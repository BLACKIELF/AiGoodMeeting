use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Rules {
    line: Vec<(String, String)>,
    inline: Vec<(String, String)>,
}

type CompiledRules = (Vec<(Regex, String)>, Vec<(Regex, String)>);

static RULES: Lazy<CompiledRules> = Lazy::new(|| {
    let rules: Rules = serde_json::from_str(include_str!(
        "../../../src/lib/summary-plain-text-rules.json"
    ))
    .expect("valid shared plain-text rules");
    let compile = |items: Vec<(String, String)>| {
        items.into_iter().map(|(pattern, replacement)| {
            (RegexBuilder::new(&pattern).case_insensitive(true).build().expect("valid plain-text pattern"), replacement)
        }).collect()
    };
    (compile(rules.line), compile(rules.inline))
});

static TABLE_PIPE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]*\|[ \t]*").unwrap());
static EXTRA_BREAKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());

/// Remove presentation syntax without changing literal names, URLs or transcript data.
pub(crate) fn to_summary_plain_text(value: &str) -> String {
    let lines = value.replace("\r\n", "\n").replace('\r', "\n")
        .split('\n').map(|original| {
            let table_row = original.trim().starts_with('|') && original.trim().ends_with('|');
            let mut line = original.to_string();
            loop {
                let previous = line.clone();
                for (pattern, replacement) in RULES.0.iter().chain(RULES.1.iter()) {
                    line = pattern.replace_all(&line, replacement.as_str()).into_owned();
                }
                if line == previous { break; }
            }
            if table_row {
                line = TABLE_PIPE.replace_all(&line, "\t").into_owned();
            }
            line.trim_end().to_string()
        }).collect::<Vec<_>>().join("\n");
    EXTRA_BREAKS.replace_all(&lines, "\n\n").trim().to_string()
}

pub(crate) fn sanitize_summary_text(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(sanitize_summary_text),
        Value::Object(fields) => {
            for (key, child) in fields.iter_mut() {
                if matches!(key.as_str(), "markdown" | "text" | "content" | "title" | "MeetingName") {
                    if let Value::String(text) = child {
                        *text = to_summary_plain_text(text);
                        continue;
                    }
                }
                sanitize_summary_text(child);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_plain_text_cases_and_idempotence() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/summary-plain-text.json"
        )).unwrap();
        for case in cases {
            let output = to_summary_plain_text(case["input"].as_str().unwrap());
            assert_eq!(output, case["output"].as_str().unwrap(), "{}", case["name"]);
            assert_eq!(to_summary_plain_text(&output), output, "{} is not idempotent", case["name"]);
        }
    }

    #[test]
    fn all_summary_formats_are_cleaned_without_mutating_identifiers() {
        let mut value = serde_json::json!({
            "markdown": "# 纪要\n**决定**",
            "summary_json": [{"id":"block#1", "content":[{"text":"**正文**", "href":"https://example.com/#section"}]}],
            "Decisions": {"title":"## 决定", "blocks":[{"content":"- 提交"}]},
            "speaker_transcript_updated_at":"unchanged",
        });
        sanitize_summary_text(&mut value);
        assert_eq!(value["markdown"], "纪要\n决定");
        assert_eq!(value["summary_json"][0]["content"][0]["text"], "正文");
        assert_eq!(value["summary_json"][0]["id"], "block#1");
        assert_eq!(value["summary_json"][0]["content"][0]["href"], "https://example.com/#section");
        assert_eq!(value["Decisions"]["title"], "决定");
        assert_eq!(value["Decisions"]["blocks"][0]["content"], "提交");
        assert_eq!(value["speaker_transcript_updated_at"], "unchanged");
    }
}
