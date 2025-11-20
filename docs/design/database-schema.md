# Database Schema Design

## Overview

The system uses PostgreSQL as the primary relational database for storing:
- User accounts and authentication
- Job metadata and status
- Processing history and analytics
- Configuration and settings

## Database: `media_encoder`

### Schema: `public`

---

## Table Definitions

### 1. `users`

Stores user account information and quota limits.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) NOT NULL UNIQUE,

    -- User tier and limits
    tier VARCHAR(20) NOT NULL DEFAULT 'free', -- free, pro, enterprise
    storage_quota_gb INTEGER NOT NULL DEFAULT 5,
    storage_used_gb DECIMAL(10, 2) NOT NULL DEFAULT 0,
    monthly_processing_minutes INTEGER NOT NULL DEFAULT 60,
    monthly_processing_used INTEGER NOT NULL DEFAULT 0,

    -- Rate limiting
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,

    -- Account status
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    email_verified_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP,

    -- Indexes
    CONSTRAINT chk_tier CHECK (tier IN ('free', 'pro', 'enterprise'))
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_api_key ON users(api_key);
CREATE INDEX idx_users_tier ON users(tier);
CREATE INDEX idx_users_created_at ON users(created_at);
```

---

### 2. `jobs`

Stores all media processing job metadata and status.

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Job configuration
    job_type VARCHAR(20) NOT NULL, -- video, image, audio
    priority VARCHAR(20) NOT NULL DEFAULT 'normal', -- high, normal, low

    -- Input file information
    input_filename VARCHAR(255) NOT NULL,
    input_size_bytes BIGINT NOT NULL,
    input_format VARCHAR(50) NOT NULL,
    input_duration_seconds DECIMAL(10, 2), -- for video/audio
    input_resolution VARCHAR(20), -- for video/image (e.g., "1920x1080")
    input_storage_path TEXT NOT NULL,
    input_url TEXT, -- Pre-signed URL for worker access

    -- Processing configuration (JSONB for flexibility)
    processing_config JSONB NOT NULL DEFAULT '{}',
    -- Example: {
    --   "video": {
    --     "outputs": [
    --       {"resolution": "1080p", "bitrate": "5000k", "format": "mp4"},
    --       {"resolution": "720p", "bitrate": "2500k", "format": "mp4"}
    --     ],
    --     "thumbnail": true
    --   }
    -- }

    -- Output information
    outputs JSONB DEFAULT '[]',
    -- Example: [
    --   {"type": "video", "resolution": "1080p", "path": "s3://...", "url": "https://...", "size_bytes": 12345},
    --   {"type": "thumbnail", "path": "s3://...", "url": "https://..."}
    -- ]

    -- Job status and progress
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Status flow: pending -> queued -> processing -> completed/failed
    progress_percentage INTEGER DEFAULT 0,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,

    -- Worker information
    worker_id VARCHAR(100), -- Pod name that processed the job
    worker_started_at TIMESTAMP,
    worker_completed_at TIMESTAMP,

    -- Timing and performance
    queued_at TIMESTAMP,
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    processing_duration_seconds INTEGER, -- Computed: completed - started

    -- Cost tracking (optional)
    estimated_cost_usd DECIMAL(10, 4),
    actual_cost_usd DECIMAL(10, 4),

    -- Metadata
    metadata JSONB DEFAULT '{}', -- Additional custom metadata

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT chk_job_type CHECK (job_type IN ('video', 'image', 'audio')),
    CONSTRAINT chk_priority CHECK (priority IN ('high', 'normal', 'low')),
    CONSTRAINT chk_status CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    CONSTRAINT chk_progress CHECK (progress_percentage >= 0 AND progress_percentage <= 100)
);

-- Indexes for common queries
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_type_status ON jobs(job_type, status);
CREATE INDEX idx_jobs_priority ON jobs(priority, status);

-- Composite index for worker queries
CREATE INDEX idx_jobs_processing ON jobs(status, queued_at) WHERE status IN ('queued', 'processing');
```

---

### 3. `job_events`

Audit log of all job state transitions and events.

```sql
CREATE TABLE job_events (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    event_type VARCHAR(50) NOT NULL, -- created, queued, processing, completed, failed, retried
    from_status VARCHAR(20),
    to_status VARCHAR(20),

    message TEXT,
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_events_job_id ON job_events(job_id, created_at DESC);
CREATE INDEX idx_job_events_type ON job_events(event_type);
CREATE INDEX idx_job_events_created_at ON job_events(created_at);

-- Partition by month for better performance (optional, for high scale)
-- CREATE TABLE job_events_2025_01 PARTITION OF job_events
-- FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

---

### 4. `webhooks`

User-configured webhook endpoints for job notifications.

```sql
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    url TEXT NOT NULL,
    secret VARCHAR(64) NOT NULL, -- For HMAC signature verification

    -- Events to trigger webhook
    events TEXT[] NOT NULL DEFAULT ARRAY['job.completed', 'job.failed'],
    -- Possible events: job.completed, job.failed, job.processing, quota.exceeded

    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Reliability tracking
    last_triggered_at TIMESTAMP,
    last_success_at TIMESTAMP,
    last_failure_at TIMESTAMP,
    failure_count INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_active ON webhooks(is_active);
```

---

### 5. `webhook_deliveries`

Log of webhook delivery attempts.

```sql
CREATE TABLE webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,

    -- Delivery status
    status VARCHAR(20) NOT NULL, -- pending, success, failed
    http_status_code INTEGER,
    response_body TEXT,
    error_message TEXT,

    attempt_count INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP
);

CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);

-- Auto-delete old deliveries after 30 days (optional)
-- Implement via cron job or pg_cron extension
```

---

### 6. `processing_presets`

Predefined processing configurations for common use cases.

```sql
CREATE TABLE processing_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,

    job_type VARCHAR(20) NOT NULL, -- video, image, audio
    config JSONB NOT NULL,

    is_public BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Usage tracking
    usage_count INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_preset_job_type CHECK (job_type IN ('video', 'image', 'audio'))
);

-- Example presets:
-- INSERT INTO processing_presets (name, job_type, config) VALUES
-- ('YouTube Standard', 'video', '{"outputs": [{"resolution": "1080p", "bitrate": "8000k"}, {"resolution": "720p", "bitrate": "5000k"}]}'),
-- ('Instagram Story', 'video', '{"outputs": [{"resolution": "1080x1920", "bitrate": "3500k"}]}'),
-- ('Podcast Audio', 'audio', '{"outputs": [{"format": "mp3", "bitrate": "128k"}]}');

CREATE INDEX idx_processing_presets_type ON processing_presets(job_type);
CREATE INDEX idx_processing_presets_public ON processing_presets(is_public);
```

---

### 7. `api_usage`

Track API usage for rate limiting and analytics.

```sql
CREATE TABLE api_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,

    status_code INTEGER NOT NULL,
    response_time_ms INTEGER,

    request_ip INET,
    user_agent TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Partition by day for better performance
CREATE INDEX idx_api_usage_user_id ON api_usage(user_id, created_at DESC);
CREATE INDEX idx_api_usage_created_at ON api_usage(created_at);

-- Time-series partitioning (optional, for high scale)
-- Use pg_partman extension or TimescaleDB
```

---

### 8. `worker_metrics`

Track worker performance and health metrics.

```sql
CREATE TABLE worker_metrics (
    id BIGSERIAL PRIMARY KEY,
    worker_id VARCHAR(100) NOT NULL, -- Pod name
    worker_type VARCHAR(20) NOT NULL, -- video, image, audio

    -- Resource usage
    cpu_usage_percent DECIMAL(5, 2),
    memory_usage_mb INTEGER,
    disk_usage_mb INTEGER,

    -- Job metrics
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    jobs_failed INTEGER NOT NULL DEFAULT 0,
    avg_processing_time_seconds DECIMAL(10, 2),

    -- Health status
    status VARCHAR(20) NOT NULL DEFAULT 'healthy', -- healthy, degraded, unhealthy
    last_heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worker_metrics_worker_id ON worker_metrics(worker_id);
CREATE INDEX idx_worker_metrics_type ON worker_metrics(worker_type);
CREATE INDEX idx_worker_metrics_status ON worker_metrics(status);
CREATE INDEX idx_worker_metrics_heartbeat ON worker_metrics(last_heartbeat_at);
```

---

## Materialized Views for Analytics

### `daily_job_stats`

Aggregated daily statistics for analytics dashboard.

```sql
CREATE MATERIALIZED VIEW daily_job_stats AS
SELECT
    DATE(created_at) as date,
    user_id,
    job_type,
    status,
    COUNT(*) as job_count,
    AVG(processing_duration_seconds) as avg_processing_seconds,
    SUM(input_size_bytes) as total_input_bytes,
    SUM(actual_cost_usd) as total_cost_usd
FROM jobs
GROUP BY DATE(created_at), user_id, job_type, status;

CREATE UNIQUE INDEX idx_daily_job_stats ON daily_job_stats(date, user_id, job_type, status);

-- Refresh daily via cron
-- REFRESH MATERIALIZED VIEW CONCURRENTLY daily_job_stats;
```

---

## Triggers and Functions

### Auto-update `updated_at` timestamp

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_presets_updated_at BEFORE UPDATE ON processing_presets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Log job state changes to `job_events`

```sql
CREATE OR REPLACE FUNCTION log_job_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO job_events (job_id, event_type, from_status, to_status, message)
        VALUES (
            NEW.id,
            'status_changed',
            OLD.status,
            NEW.status,
            format('Job status changed from %s to %s', OLD.status, NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_job_status_change_trigger
AFTER UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION log_job_status_change();
```

### Reset monthly quotas (run via cron on 1st of month)

```sql
CREATE OR REPLACE FUNCTION reset_monthly_quotas()
RETURNS void AS $$
BEGIN
    UPDATE users
    SET monthly_processing_used = 0
    WHERE monthly_processing_used > 0;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron extension:
-- SELECT cron.schedule('reset-quotas', '0 0 1 * *', 'SELECT reset_monthly_quotas()');
```

---

## Data Retention Policies

### Automated cleanup queries (run daily via cron)

```sql
-- Delete old job events (keep 90 days)
DELETE FROM job_events
WHERE created_at < NOW() - INTERVAL '90 days';

-- Delete old API usage logs (keep 30 days)
DELETE FROM api_usage
WHERE created_at < NOW() - INTERVAL '30 days';

-- Delete old webhook deliveries (keep 30 days)
DELETE FROM webhook_deliveries
WHERE created_at < NOW() - INTERVAL '30 days';

-- Archive old completed jobs (move to archive table)
INSERT INTO jobs_archive
SELECT * FROM jobs
WHERE status IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '180 days';

DELETE FROM jobs
WHERE status IN ('completed', 'failed')
  AND updated_at < NOW() - INTERVAL '180 days';
```

---

## Backup Strategy

```bash
# Daily full backup
pg_dump -Fc media_encoder > backup_$(date +%Y%m%d).dump

# Point-in-time recovery (enable WAL archiving)
# wal_level = replica
# archive_mode = on
# archive_command = 'cp %p /backup/wal/%f'

# Restore from backup
pg_restore -d media_encoder backup_20250101.dump
```

---

## Performance Optimization

### Connection Pooling (PgBouncer)

```ini
[databases]
media_encoder = host=postgres port=5432 dbname=media_encoder

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
```

### Query Optimization Tips

1. **Use covering indexes** for frequently queried columns
2. **Partition large tables** (jobs, job_events, api_usage) by time
3. **Use EXPLAIN ANALYZE** to identify slow queries
4. **Implement read replicas** for analytics queries
5. **Use materialized views** for expensive aggregations

### Example Slow Query Optimization

```sql
-- Slow query: Get user's recent jobs
EXPLAIN ANALYZE
SELECT * FROM jobs
WHERE user_id = 'uuid-here'
ORDER BY created_at DESC
LIMIT 10;

-- Optimize with composite index
CREATE INDEX idx_jobs_user_recent ON jobs(user_id, created_at DESC);
```

---

## Migration Strategy

Use a migration tool like **Flyway** or **golang-migrate**.

### Example Migration Structure

```
migrations/
├── 000001_create_users_table.up.sql
├── 000001_create_users_table.down.sql
├── 000002_create_jobs_table.up.sql
├── 000002_create_jobs_table.down.sql
├── 000003_create_indexes.up.sql
├── 000003_create_indexes.down.sql
```

### Example Migration File

```sql
-- 000001_create_users_table.up.sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    -- ... rest of schema
);

-- 000001_create_users_table.down.sql
DROP TABLE IF EXISTS users;
```

---

## Monitoring Queries

### Check database size
```sql
SELECT pg_size_pretty(pg_database_size('media_encoder'));
```

### Check table sizes
```sql
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Check slow queries
```sql
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### Check active connections
```sql
SELECT
    count(*) as connections,
    state
FROM pg_stat_activity
GROUP BY state;
```
