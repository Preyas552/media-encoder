# System Architecture Design

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Load Balancer                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────▼────────┐       ┌───────▼────────┐
        │   API Service  │       │   API Service  │
        │   (Upload)     │       │   (Upload)     │
        └───────┬────────┘       └───────┬────────┘
                │                         │
                └────────────┬────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  PostgreSQL  │    │ Object Store │    │ Message Queue│
│  (Metadata)  │    │   (S3/MinIO) │    │ (Redis/Kafka)│
└──────────────┘    └──────────────┘    └───────┬──────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    │            │            │
                            ┌───────▼──┐  ┌─────▼───┐  ┌─────▼───┐
                            │ Worker-1 │  │Worker-2 │  │Worker-N │
                            │  Pod     │  │  Pod    │  │  Pod    │
                            └───────┬──┘  └─────┬───┘  └─────┬───┘
                                    │           │            │
                                    └───────────┼────────────┘
                                                │
                                        ┌───────▼──────┐
                                        │ Object Store │
                                        │  (Outputs)   │
                                        └──────────────┘
```

## Component Breakdown

### 1. API Service (Upload Service)

**Responsibilities:**
- Accept file uploads via HTTP/HTTPS
- Validate user authentication and authorization
- Perform initial file validation (size, format, malware scan)
- Store files to object storage
- Create job records in database
- Enqueue processing jobs
- Provide job status endpoints
- Serve processed file URLs

**Technology:**
- Language: Go or Node.js
- Framework: Gin (Go) or Express (Node.js)
- Deployment: Kubernetes Deployment (2-5 replicas)

**Scaling Strategy:**
- Horizontal scaling based on CPU/memory usage
- Target: 70% CPU utilization
- Min replicas: 2 (for HA)
- Max replicas: 10

### 2. Message Queue

**Responsibilities:**
- Buffer processing jobs
- Provide job persistence
- Support priority queuing
- Enable retry mechanisms
- Decouple upload from processing

**Queue Options:**

#### Option A: Redis (Recommended for MVP)
- Pros: Simple, fast, easy to deploy
- Cons: Limited persistence guarantees
- Use Case: Small to medium scale (<10k jobs/day)

#### Option B: RabbitMQ (Recommended for Production)
- Pros: Reliable, excellent retry logic, dead letter queues
- Cons: More complex to operate
- Use Case: Production workloads with reliability requirements

#### Option C: Kafka (For High Scale)
- Pros: High throughput, partitioning, replay capability
- Cons: Complex, overkill for small scale
- Use Case: High scale (>100k jobs/day)

**Queue Design:**
```
Queues:
- jobs.video.high      (High priority video jobs)
- jobs.video.normal    (Normal priority video jobs)
- jobs.image.high      (High priority image jobs)
- jobs.image.normal    (Normal priority image jobs)
- jobs.audio.high      (High priority audio jobs)
- jobs.audio.normal    (Normal priority audio jobs)
- jobs.dlq             (Dead letter queue for failures)
```

### 3. Worker Pods

**Responsibilities:**
- Poll queue for new jobs
- Download source files from object storage
- Process media using FFmpeg
- Upload processed files to object storage
- Update job status in database
- Handle errors and retries

**Worker Types:**
- **Video Workers**: Heavy CPU/memory (4 vCPU, 8GB RAM)
- **Image Workers**: Medium resources (2 vCPU, 4GB RAM)
- **Audio Workers**: Light resources (1 vCPU, 2GB RAM)

**Scaling Strategy:**
- Use KEDA (Kubernetes Event-Driven Autoscaler)
- Scale based on queue depth
- Target: 5 messages per worker
- Min replicas: 1 per job type
- Max replicas: 50 per job type

### 4. Object Storage

**Structure:**
```
Buckets:
- media-uploads/          (Raw uploaded files)
  └── {user_id}/
      └── {job_id}/
          └── original.{ext}

- media-processed/        (Processed outputs)
  └── {user_id}/
      └── {job_id}/
          ├── 1080p.mp4
          ├── 720p.mp4
          ├── 480p.mp4
          └── thumbnail.jpg

- media-temp/             (Temporary working files)
  └── {job_id}/
      └── chunks/
```

**Lifecycle Policies:**
- media-uploads: Retain for 30 days
- media-processed: Retain based on user tier
- media-temp: Delete after 1 day

### 5. PostgreSQL Database

**Purpose:**
- Store job metadata and status
- Track user information and quotas
- Audit logging
- Analytics data

**Connection Pooling:**
- PgBouncer for connection pooling
- Pool size: 20 connections per API instance

### 6. Monitoring & Observability

**Metrics (Prometheus):**
- Queue depth by job type
- Worker utilization (CPU, memory)
- Job processing time (p50, p95, p99)
- Job success/failure rates
- API request rates and latencies
- Storage usage

**Logging (Loki or ELK):**
- Structured JSON logs
- Centralized aggregation
- Log levels: DEBUG, INFO, WARN, ERROR
- Retention: 30 days

**Tracing (Jaeger - Optional):**
- Distributed tracing for debugging
- Track job lifecycle across components

**Alerting:**
- Queue depth > threshold
- Worker pod crashes
- Job failure rate > 10%
- API error rate > 5%
- Storage near capacity

## Data Flow

### Upload Flow
```
1. User → API: POST /upload (multipart/form-data)
2. API → API: Validate auth, file size, format
3. API → S3: Upload file to media-uploads/{user_id}/{job_id}/
4. API → DB: INSERT job record (status=pending)
5. API → Queue: Publish job message
6. API → User: Return {job_id, status}
```

### Processing Flow
```
1. Worker → Queue: Poll for messages
2. Worker → Queue: Acknowledge message (visibility timeout)
3. Worker → DB: UPDATE job status=processing
4. Worker → S3: Download source file
5. Worker → FFmpeg: Process media
6. Worker → S3: Upload processed files
7. Worker → DB: UPDATE job status=completed, output_urls
8. Worker → Queue: Delete message (or send to DLQ on failure)
9. Worker → Webhook: Notify user (optional)
```

### Retrieval Flow
```
1. User → API: GET /jobs/{job_id}
2. API → DB: SELECT job record
3. API → User: Return {status, progress, output_urls}
4. User → S3: Download file via pre-signed URL (direct, no API)
```

## Security Architecture

### Authentication & Authorization
- API Key authentication for programmatic access
- JWT tokens for web applications
- Rate limiting: 100 requests/minute per API key
- User quotas: Storage and processing limits

### File Security
- Virus scanning on upload (ClamAV integration)
- File signature validation (not just extension)
- Content-Type validation
- Maximum file size limits (configurable per user tier)

### Network Security
- TLS 1.3 for all external communication
- Private networking between services (VPC)
- No public access to worker pods
- S3 bucket policies (private by default)

### Data Encryption
- At rest: S3 server-side encryption (SSE-S3)
- In transit: TLS for all connections
- Database: Encrypted storage volumes

## Disaster Recovery

### Backup Strategy
- Database: Daily snapshots, 7-day retention
- Object storage: Versioning enabled, cross-region replication (optional)
- Configuration: GitOps (all configs in version control)

### Recovery Scenarios
- **API failure**: Auto-restart, multiple replicas for HA
- **Worker failure**: Job requeued automatically, retry with backoff
- **Database failure**: Failover to replica (RDS Multi-AZ)
- **Queue failure**: Jobs persisted to disk, restore from backup
- **Storage failure**: Restore from versioned backups

## Performance Targets

### Latency
- Upload API: p95 < 200ms (excluding upload time)
- Job status API: p95 < 100ms
- Queue message processing: < 1s from publish to worker pickup

### Throughput
- MVP: 1,000 jobs/day
- Production: 100,000 jobs/day
- Enterprise: 1M+ jobs/day

### Availability
- API: 99.9% uptime (8.76 hours downtime/year)
- Workers: Best effort (jobs retried on failure)
- Storage: 99.99% (S3 SLA)

## Cost Optimization

### Strategies
1. **Spot Instances**: Use for workers (50-70% savings)
2. **Storage Lifecycle**: Auto-delete old files
3. **Intelligent Tiering**: Move cold data to S3 Glacier
4. **Right-Sizing**: Monitor and adjust worker resources
5. **CDN**: Cache frequently accessed outputs
6. **Compression**: Compress media before storage

### Cost Breakdown (Example)
```
Monthly costs for 10,000 jobs/month:
- Compute (workers): $400
- Storage (100GB avg): $25
- Database: $50
- Queue: $20
- Data transfer: $30
- Monitoring: $25
Total: ~$550/month
```

## Scalability Considerations

### Horizontal Scaling
- All components stateless (except database)
- Workers scale independently by job type
- API scales based on request load

### Vertical Scaling
- Database can be upgraded for higher connection limits
- Workers can be resized for larger files

### Geographic Distribution
- Multi-region deployment for global users
- Regional storage buckets
- CDN for content delivery

### Queue Partitioning
- Partition queues by job type
- Partition by priority
- Partition by user tier (enterprise users get dedicated queues)

## Technology Decision Matrix

| Component | Option A | Option B | Option C | Recommendation |
|-----------|----------|----------|----------|----------------|
| Language | Go | Node.js | Python | Go (performance) |
| Queue | Redis | RabbitMQ | Kafka | RabbitMQ (production) |
| Database | PostgreSQL | MySQL | MongoDB | PostgreSQL |
| Storage | AWS S3 | MinIO | DigitalOcean | AWS S3 (production), MinIO (dev) |
| Orchestration | Docker Compose | Kubernetes | ECS | Kubernetes |
| Monitoring | Prometheus | Datadog | New Relic | Prometheus (cost) |

## Implementation Phases

### Phase 1: Local Development (Week 1-2)
- Docker Compose setup
- Single API service
- Redis queue
- Single worker type (video only)
- MinIO for storage
- PostgreSQL database

### Phase 2: Kubernetes Migration (Week 3-4)
- Convert to K8s manifests
- Multi-worker types
- Basic HPA autoscaling
- Health checks and readiness probes

### Phase 3: Production Hardening (Week 5-8)
- KEDA autoscaling
- Comprehensive monitoring
- Alerting setup
- Security hardening
- Load testing and optimization

### Phase 4: Advanced Features (Week 9+)
- Webhooks
- Advanced analytics
- Multi-region support
- Custom processing pipelines
