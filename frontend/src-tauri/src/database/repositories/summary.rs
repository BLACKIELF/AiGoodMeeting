use super::meeting::MeetingsRepository;
use crate::database::models::SummaryProcess;
use crate::summary::plain_text::sanitize_summary_text;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{error, info as log_info};

pub struct SummaryProcessesRepository;

fn sanitize_stored_summary(raw: &mut Option<String>) {
    if let Some(value) = raw {
        if let Ok(mut summary) = serde_json::from_str::<Value>(value) {
            sanitize_summary_text(&mut summary);
            *value = summary.to_string();
        }
    }
}

fn sanitize_process(mut process: SummaryProcess) -> SummaryProcess {
    sanitize_stored_summary(&mut process.result);
    sanitize_stored_summary(&mut process.result_backup);
    process
}

impl SummaryProcessesRepository {
    /// Retrieves the current summary process state for a given meeting ID.
    pub async fn get_summary_data(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>("SELECT * FROM summary_processes WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
            .map(|process| process.map(sanitize_process))
    }

    pub async fn update_meeting_summary(
        pool: &SqlitePool,
        meeting_id: &str,
        summary: &Value,
    ) -> Result<bool, sqlx::Error> {
        let mut transaction = pool.begin().await?;

        let meeting_exists: bool = sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();

        if !meeting_exists {
            log_info!(
                "Attempted to save summary for a non-existent meeting_id: {}",
                meeting_id
            );
            transaction.rollback().await?;
            return Ok(false);
        }

        let mut summary = summary.clone();
        sanitize_summary_text(&mut summary);
        let result_json = serde_json::to_string(&summary);
        if result_json.is_err() {
            error!("Can't convert the json to string for saving to Database");
            transaction.rollback().await?;
            return Ok(false);
        }
        let now = Utc::now();
        let update = sqlx::query("UPDATE summary_processes SET result = ?, updated_at = ? WHERE meeting_id = ?")
            .bind(&result_json.unwrap())
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        if update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;

        log_info!(
            "Successfully updated summary and timestamp for meeting_id: {}",
            meeting_id
        );
        Ok(true)
    }

    pub async fn get_summary_data_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<SummaryProcess>, sqlx::Error> {
        sqlx::query_as::<_, SummaryProcess>(
            "SELECT p.* FROM summary_processes p JOIN transcript_chunks t ON p.meeting_id = t.meeting_id WHERE p.meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .map(|process| process.map(sanitize_process))
    }

    pub async fn create_or_reset_process(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        log_info!(
            "Creating or resetting summary process for meeting_id: {}",
            meeting_id
        );
        let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
        // Lock before reading so backup sanitation and reset remain one atomic write.
        let mut previous: Option<String> = sqlx::query_scalar(
            "SELECT result FROM summary_processes WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?
        .flatten();
        sanitize_stored_summary(&mut previous);
        sqlx::query(
            r#"
            INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time, result, error)
            VALUES (?, 'PENDING', ?, ?, ?, ?, NULL)
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                updated_at = excluded.updated_at,
                start_time = excluded.start_time,
                result_backup = excluded.result,
                result_backup_timestamp = excluded.updated_at,
                result = excluded.result,
                error = NULL
            "#
        )
        .bind(meeting_id)
        .bind(started_at)
        .bind(started_at)
        .bind(started_at)
        .bind(previous)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        log_info!(
            "Backed up existing summary before regeneration for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_process_completed(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        mut result: Value,
        chunk_count: i64,
        processing_time: f64,
        generated_title: Option<(&str, &str)>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        sanitize_summary_text(&mut result);
        let result_str = serde_json::to_string(&result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;

        let mut transaction = pool.begin().await?;
        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET status = 'completed', result = ?, updated_at = ?, end_time = ?, chunk_count = ?, processing_time = ?, error = NULL, result_backup = NULL, result_backup_timestamp = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#
        )
        .bind(result_str)
        .bind(now)
        .bind(now)
        .bind(chunk_count)
        .bind(processing_time)
        .bind(meeting_id)
        .bind(started_at)
        .execute(&mut *transaction)
        .await?;
        if update.rows_affected() != 1 {
            transaction.rollback().await?;
            return Ok(false);
        }
        if let Some((expected_title, new_title)) = generated_title {
            MeetingsRepository::update_generated_meeting_name(
                &mut transaction, meeting_id, expected_title, new_title,
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn update_process_failed(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        error: &str,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
        let mut restored: Option<String> = sqlx::query_scalar(
            "SELECT COALESCE(result_backup, result) FROM summary_processes WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'",
        )
        .bind(meeting_id)
        .bind(started_at)
        .fetch_optional(&mut *transaction)
        .await?
        .flatten();
        sanitize_stored_summary(&mut restored);

        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'failed',
                error = ?,
                updated_at = ?,
                end_time = ?,
                result = ?,
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#,
        )
        .bind(error)
        .bind(now)
        .bind(now)
        .bind(restored)
        .bind(meeting_id)
        .bind(started_at)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(update.rows_affected() == 1)
    }

    pub async fn update_process_cancelled(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
        let mut restored: Option<String> = sqlx::query_scalar(
            "SELECT COALESCE(result_backup, result) FROM summary_processes WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'",
        )
        .bind(meeting_id)
        .bind(started_at)
        .fetch_optional(&mut *transaction)
        .await?
        .flatten();
        sanitize_stored_summary(&mut restored);

        let update = sqlx::query(
            r#"
            UPDATE summary_processes
            SET
                status = 'cancelled',
                updated_at = ?,
                end_time = ?,
                error = 'Generation was cancelled by user',
                result = ?,
                result_backup = NULL,
                result_backup_timestamp = NULL
            WHERE meeting_id = ? AND start_time = ? AND LOWER(status) = 'pending'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(restored)
        .bind(meeting_id)
        .bind(started_at)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(update.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE summary_processes (
                meeting_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                start_time TEXT,
                result TEXT,
                result_backup TEXT,
                result_backup_timestamp TEXT,
                end_time TEXT,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                processing_time REAL NOT NULL DEFAULT 0,
                error TEXT,
                metadata TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn seed_pending(
        pool: &SqlitePool,
        meeting_id: &str,
        started_at: DateTime<Utc>,
        result: Option<&str>,
        result_backup: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO summary_processes (
                meeting_id, status, created_at, updated_at, start_time, result, result_backup
            ) VALUES (?, 'PENDING', ?, ?, ?, ?, ?)",
        )
        .bind(meeting_id)
        .bind(started_at)
        .bind(started_at)
        .bind(started_at)
        .bind(result)
        .bind(result_backup)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn summary_repository_sanitizes_reads_and_both_write_paths() {
        let pool = test_pool().await;
        sqlx::raw_sql("CREATE TABLE meetings (id TEXT PRIMARY KEY, updated_at TEXT);
            CREATE TABLE transcript_chunks (meeting_id TEXT);
            INSERT INTO meetings VALUES ('plain', NULL);
            INSERT INTO transcript_chunks VALUES ('plain');")
            .execute(&pool).await.unwrap();
        let started_at = Utc::now();
        let dirty = json!({"markdown":"# 纪要\n- **决定**", "english_cache":{"markdown":"## Decision"}});
        seed_pending(&pool, "plain", started_at, Some(&dirty.to_string()), Some(&dirty.to_string())).await;
        for process in [
            SummaryProcessesRepository::get_summary_data(&pool, "plain").await.unwrap().unwrap(),
            SummaryProcessesRepository::get_summary_data_for_meeting(&pool, "plain").await.unwrap().unwrap(),
        ] {
            for raw in [process.result, process.result_backup] {
                let value: Value = serde_json::from_str(&raw.unwrap()).unwrap();
                assert_eq!(value["markdown"], "纪要\n决定");
                assert_eq!(value["english_cache"]["markdown"], "Decision");
            }
        }
        assert!(SummaryProcessesRepository::update_meeting_summary(&pool, "plain", &dirty).await.unwrap());
        let saved: String = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id = 'plain'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(serde_json::from_str::<Value>(&saved).unwrap()["markdown"], "纪要\n决定");
        assert!(SummaryProcessesRepository::update_process_completed(&pool, "plain", started_at, dirty, 1, 1.0, None).await.unwrap());
        let saved: String = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id = 'plain'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(serde_json::from_str::<Value>(&saved).unwrap()["markdown"], "纪要\n决定");
    }

    #[tokio::test]
    async fn summary_reset_and_terminal_restore_clean_legacy_backups() {
        let pool = test_pool().await;
        let dirty = json!({"markdown":"# 旧纪要\n**决定**"}).to_string();
        let started_at = Utc::now();
        seed_pending(&pool, "reset", started_at, Some(&dirty), None).await;
        SummaryProcessesRepository::create_or_reset_process(&pool, "reset", started_at).await.unwrap();
        let reset: (String, String) = sqlx::query_as("SELECT result, result_backup FROM summary_processes WHERE meeting_id = 'reset'")
            .fetch_one(&pool).await.unwrap();
        for raw in [reset.0, reset.1] {
            assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["markdown"], "旧纪要\n决定");
        }
        for id in ["failed", "cancelled"] {
            seed_pending(&pool, id, started_at, None, Some(&dirty)).await;
            let updated = if id == "failed" {
                SummaryProcessesRepository::update_process_failed(&pool, id, started_at, "failed").await.unwrap()
            } else {
                SummaryProcessesRepository::update_process_cancelled(&pool, id, started_at).await.unwrap()
            };
            assert!(updated);
            let raw: String = sqlx::query_scalar("SELECT result FROM summary_processes WHERE meeting_id = ?")
                .bind(id).fetch_one(&pool).await.unwrap();
            assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["markdown"], "旧纪要\n决定");
        }
    }

    #[tokio::test]
    async fn completion_renames_only_the_unchanged_meeting() {
        let pool = test_pool().await;
        sqlx::raw_sql(
            "CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT);
             CREATE TABLE transcript_chunks (meeting_id TEXT, meeting_name TEXT);
             INSERT INTO meetings VALUES ('fresh', '临时标题', NULL), ('edited', '手动改名', NULL);
             INSERT INTO transcript_chunks VALUES ('fresh', '临时标题'), ('edited', '手动改名');",
        )
        .execute(&pool)
        .await
        .unwrap();

        for (meeting_id, expected_name) in [("fresh", "发布计划"), ("edited", "手动改名")] {
            let started_at = Utc::now();
            seed_pending(&pool, meeting_id, started_at, None, None).await;
            assert!(SummaryProcessesRepository::update_process_completed(
                &pool,
                meeting_id,
                started_at,
                json!({"markdown": "周五发布。"}),
                1,
                1.0,
                Some(("临时标题", "发布计划")),
            )
            .await
            .unwrap());

            let saved: (String, String, String) = sqlx::query_as(
                "SELECT title, meeting_name, status FROM meetings
                 JOIN transcript_chunks ON transcript_chunks.meeting_id = meetings.id
                 JOIN summary_processes ON summary_processes.meeting_id = meetings.id
                 WHERE meetings.id = ?",
            )
            .bind(meeting_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(saved, (expected_name.into(), expected_name.into(), "completed".into()));
        }
    }

    #[tokio::test]
    async fn terminal_compare_and_set_preserves_first_writer() {
        let pool = test_pool().await;
        let completed_start = Utc::now();
        seed_pending(&pool, "completed-first", completed_start, None, None).await;
        assert!(
            SummaryProcessesRepository::update_process_completed(
                &pool,
                "completed-first",
                completed_start,
                json!({"markdown": "completed"}),
                1,
                1.0,
                None,
            )
            .await
            .unwrap()
        );
        assert!(
            !SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "completed-first",
                completed_start,
            )
            .await
            .unwrap()
        );
        let completed_status: String = sqlx::query_scalar(
            "SELECT status FROM summary_processes WHERE meeting_id = 'completed-first'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(completed_status, "completed");

        let cancelled_start = completed_start + chrono::Duration::nanoseconds(1);
        let previous = r#"{"markdown":"previous"}"#;
        seed_pending(
            &pool,
            "cancelled-first",
            cancelled_start,
            Some(previous),
            Some(previous),
        )
        .await;
        assert!(
            SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "cancelled-first",
                cancelled_start,
            )
            .await
            .unwrap()
        );
        assert!(
            !SummaryProcessesRepository::update_process_completed(
                &pool,
                "cancelled-first",
                cancelled_start,
                json!({"markdown": "completed"}),
                1,
                1.0,
                None,
            )
            .await
            .unwrap()
        );
        let cancelled: (String, String) = sqlx::query_as(
            "SELECT status, result FROM summary_processes WHERE meeting_id = 'cancelled-first'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cancelled, ("cancelled".to_string(), previous.to_string()));
    }

    #[tokio::test]
    async fn cancelled_compare_and_set_rejects_stale_start_time() {
        let pool = test_pool().await;
        let current_start = Utc::now();
        seed_pending(&pool, "stale-cancel", current_start, None, None).await;
        assert!(
            !SummaryProcessesRepository::update_process_cancelled(
                &pool,
                "stale-cancel",
                current_start - chrono::Duration::nanoseconds(1),
            )
            .await
            .unwrap()
        );
        let status: String =
            sqlx::query_scalar("SELECT status FROM summary_processes WHERE meeting_id = 'stale-cancel'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "PENDING");
    }
}
