# LocalStack Development Setup

## Overview

This guide sets up the entire media encoder system using **LocalStack** to emulate AWS services locally. When ready, you can migrate to real AWS with minimal code changes.

## Why LocalStack?

✅ **Pros:**
- No AWS costs during development
- Fast iteration (no internet latency)
- Full AWS service emulation (S3, SQS, SNS, etc.)
- Easy CI/CD testing
- Simple migration to real AWS

❌ **Cons:**
- Some AWS features not fully supported
- Requires Docker resources
- Free tier has limitations (Pro version has more features)

---

## Architecture with LocalStack

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose                        │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │   API        │    │   Worker     │                 │
│  │   Service    │    │   Pods       │                 │
│  └──────┬───────┘    └──────┬───────┘                 │
│         │                    │                          │
│         ├────────────────────┼──────────────┐          │
│         │                    │              │          │
│         ▼                    ▼              ▼          │
│  ┌──────────────┐    ┌──────────────┐  ┌─────────┐   │
│  │  PostgreSQL  │    │  LocalStack  │  │  Redis  │   │
│  │              │    │  (AWS APIs)  │  │  Queue  │   │
│  └──────────────┘    │  - S3        │  └─────────┘   │
│                      │  - SQS       │                 │
│                      │  - SNS       │                 │
│                      │  - Secrets   │                 │
│                      └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: LocalStack Setup (1 day)

### 1. Docker Compose with LocalStack

**File: `docker-compose.localstack.yml`**

```yaml
version: '3.8'

services:
  # LocalStack - AWS Service Emulator
  localstack:
    image: localstack/localstack:latest
    container_name: localstack
    ports:
      - "4566:4566"            # LocalStack Gateway (all services)
      - "4510-4559:4510-4559"  # External service port range
    environment:
      - SERVICES=s3,sqs,sns,secretsmanager,cloudwatch
      - DEBUG=1
      - DATA_DIR=/tmp/localstack/data
      - DOCKER_HOST=unix:///var/run/docker.sock
      - AWS_DEFAULT_REGION=us-east-1
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
    volumes:
      - "${TMPDIR:-/tmp}/localstack:/tmp/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
      - "./scripts/localstack-init.sh:/etc/localstack/init/ready.d/init.sh"
    healthcheck:
      test: ["CMD", "awslocal", "s3", "ls"]
      interval: 10s
      timeout: 5s
      retries: 5

  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: postgres
    environment:
      POSTGRES_DB: media_encoder
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Redis Queue
  redis:
    image: redis:7-alpine
    container_name: redis
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  # API Service
  api:
    build:
      context: .
      dockerfile: docker/api/Dockerfile.dev
    container_name: media-encoder-api
    environment:
      NODE_ENV: development
      PORT: 8080

      # Database
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/media_encoder

      # Redis
      REDIS_URL: redis://redis:6379

      # LocalStack S3
      AWS_ENDPOINT: http://localstack:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      S3_BUCKET_UPLOADS: media-uploads
      S3_BUCKET_PROCESSED: media-processed
      S3_FORCE_PATH_STYLE: "true"  # Required for LocalStack

    ports:
      - "8080:8080"
    volumes:
      - ./api:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      localstack:
        condition: service_healthy

  # Video Worker
  worker-video:
    build:
      context: .
      dockerfile: docker/worker/Dockerfile.dev
    container_name: media-encoder-worker-video
    environment:
      WORKER_TYPE: video
      QUEUE_NAMES: jobs.video.high,jobs.video.normal

      # Database
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/media_encoder

      # Redis
      REDIS_URL: redis://redis:6379

      # LocalStack S3
      AWS_ENDPOINT: http://localstack:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      S3_FORCE_PATH_STYLE: "true"

    volumes:
      - ./worker:/app
      - /tmp/processing:/tmp/processing
    depends_on:
      - postgres
      - redis
      - localstack
    deploy:
      replicas: 2

volumes:
  postgres-data:
  redis-data:
```

### 2. LocalStack Initialization Script

**File: `scripts/localstack-init.sh`**

```bash
#!/bin/bash

echo "Initializing LocalStack..."

# Wait for LocalStack to be ready
awslocal s3 ls || exit 1

# Create S3 buckets
echo "Creating S3 buckets..."
awslocal s3 mb s3://media-uploads
awslocal s3 mb s3://media-processed
awslocal s3 mb s3://media-temp

# Set bucket CORS (for web uploads)
awslocal s3api put-bucket-cors --bucket media-uploads --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }]
}'

# Create SQS queues (optional - if using SQS instead of Redis)
echo "Creating SQS queues..."
awslocal sqs create-queue --queue-name jobs-video-high
awslocal sqs create-queue --queue-name jobs-video-normal
awslocal sqs create-queue --queue-name jobs-image-normal
awslocal sqs create-queue --queue-name jobs-audio-normal
awslocal sqs create-queue --queue-name jobs-dlq

# Create SNS topics (for webhooks)
echo "Creating SNS topics..."
awslocal sns create-topic --name job-completed
awslocal sns create-topic --name job-failed

# Store secrets in Secrets Manager
echo "Creating secrets..."
awslocal secretsmanager create-secret \
  --name media-encoder/db-credentials \
  --secret-string '{"username":"postgres","password":"postgres"}'

echo "LocalStack initialization complete!"
```

Make it executable:
```bash
chmod +x scripts/localstack-init.sh
```

---

## Phase 2: AWS-Compatible Code (2-3 days)

### Key: Write Code That Works with Both LocalStack AND AWS

### 1. S3 Client Configuration

**File: `shared/src/storage/s3-client.ts`**

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Configuration that works with both LocalStack and AWS
const config = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
  // Only use endpoint for LocalStack
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  }),
};

export const s3Client = new S3Client(config);

// Upload file to S3
export async function uploadFile(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);
}

// Generate pre-signed URL
export async function getPresignedUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600
) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}
```

### 2. Environment Configuration

**File: `.env.localstack`**

```bash
# Environment
NODE_ENV=development

# API
PORT=8080

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/media_encoder

# Redis
REDIS_URL=redis://localhost:6379

# LocalStack AWS
AWS_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# S3 Configuration
S3_BUCKET_UPLOADS=media-uploads
S3_BUCKET_PROCESSED=media-processed
S3_BUCKET_TEMP=media-temp
S3_FORCE_PATH_STYLE=true

# Feature Flags
USE_SQS=false  # Set to true to use SQS instead of Redis
```

**File: `.env.production`** (for real AWS)

```bash
# Environment
NODE_ENV=production

# API
PORT=8080

# Database (RDS)
DATABASE_URL=postgresql://user:pass@prod-db.region.rds.amazonaws.com:5432/media_encoder

# Redis (ElastiCache)
REDIS_URL=redis://prod-redis.cache.amazonaws.com:6379

# AWS (no endpoint - uses real AWS)
AWS_REGION=us-east-1
# AWS credentials from IAM role (no keys needed)

# S3 Configuration
S3_BUCKET_UPLOADS=prod-media-uploads
S3_BUCKET_PROCESSED=prod-media-processed
S3_BUCKET_TEMP=prod-media-temp
S3_FORCE_PATH_STYLE=false

# Feature Flags
USE_SQS=true
```

---

## Phase 3: Development Workflow (Ongoing)

### Starting the System

```bash
# Start LocalStack and all services
docker-compose -f docker-compose.localstack.yml up -d

# Check LocalStack is ready
docker-compose logs localstack | grep "Ready"

# Verify S3 buckets were created
docker-compose exec localstack awslocal s3 ls

# Expected output:
# 2024-01-17 10:00:00 media-uploads
# 2024-01-17 10:00:00 media-processed
# 2024-01-17 10:00:00 media-temp
```

### Testing S3 Operations

```bash
# Install AWS CLI Local wrapper
pip install awscli-local

# List buckets
awslocal s3 ls

# Upload test file
echo "test" > test.txt
awslocal s3 cp test.txt s3://media-uploads/test.txt

# Download file
awslocal s3 cp s3://media-uploads/test.txt downloaded.txt

# List bucket contents
awslocal s3 ls s3://media-uploads/
```

### Accessing LocalStack Services

```bash
# S3 Web UI (if using LocalStack Pro)
# Visit: http://localhost:4566/_localstack/health

# Check service status
curl http://localhost:4566/_localstack/health | jq

# Example response:
# {
#   "services": {
#     "s3": "running",
#     "sqs": "running",
#     "sns": "running"
#   }
# }
```

---

## Phase 4: Migration to Real AWS (1-2 days)

### When You're Ready for Production...

### 1. Create AWS Resources

**Option A: Using Terraform**

```hcl
# terraform/main.tf
provider "aws" {
  region = "us-east-1"
}

# S3 Buckets
resource "aws_s3_bucket" "uploads" {
  bucket = "prod-media-uploads-${random_id.suffix.hex}"
}

resource "aws_s3_bucket" "processed" {
  bucket = "prod-media-processed-${random_id.suffix.hex}"
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier           = "media-encoder-db"
  engine              = "postgres"
  engine_version      = "15.4"
  instance_class      = "db.t3.medium"
  allocated_storage   = 100

  db_name  = "media_encoder"
  username = var.db_username
  password = var.db_password

  multi_az = true
  publicly_accessible = false
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "media-encoder-redis"
  engine               = "redis"
  node_type            = "cache.t3.medium"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
}

# Output connection strings
output "db_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}
```

**Option B: Using AWS CLI**

```bash
# Create S3 buckets
aws s3 mb s3://prod-media-uploads
aws s3 mb s3://prod-media-processed

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier media-encoder-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --allocated-storage 100 \
  --db-name media_encoder \
  --master-username postgres \
  --master-user-password YourSecurePassword

# Create ElastiCache Redis
aws elasticache create-cache-cluster \
  --cache-cluster-id media-encoder-redis \
  --cache-node-type cache.t3.medium \
  --engine redis \
  --num-cache-nodes 1
```

### 2. Update Environment Variables

Simply switch from `.env.localstack` to `.env.production`:

```bash
# Remove LocalStack-specific configs
# AWS_ENDPOINT=http://localhost:4566  ← Remove this
# S3_FORCE_PATH_STYLE=true  ← Remove this

# Update to production values
DATABASE_URL=postgresql://user:pass@prod-db.rds.amazonaws.com:5432/media_encoder
REDIS_URL=redis://prod-redis.cache.amazonaws.com:6379
S3_BUCKET_UPLOADS=prod-media-uploads
S3_BUCKET_PROCESSED=prod-media-processed
```

**That's it!** Your code doesn't need to change because you wrote it to be AWS-compatible from day 1.

### 3. Deploy to AWS

```bash
# Build images
docker build -t media-encoder-api:latest -f docker/api/Dockerfile .
docker build -t media-encoder-worker:latest -f docker/worker/Dockerfile .

# Push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker tag media-encoder-api:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/media-encoder-api:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/media-encoder-api:latest

# Deploy to EKS/ECS
kubectl apply -f k8s/production/
```

---

## Comparison: LocalStack vs Real AWS

| Feature | LocalStack | Real AWS |
|---------|-----------|----------|
| **Cost** | Free (community) | Pay-per-use |
| **Speed** | Very fast (local) | Network latency |
| **S3** | Full support | Full support |
| **SQS** | Full support | Full support |
| **RDS** | Limited | Full support |
| **IAM** | Limited | Full support |
| **Setup** | 5 minutes | 30+ minutes |
| **Migration** | Change env vars only | N/A |

---

## Development Best Practices

### 1. Always Use Environment Variables

❌ **Don't:**
```typescript
const s3 = new S3Client({
  endpoint: 'http://localhost:4566',  // Hardcoded!
});
```

✅ **Do:**
```typescript
const s3 = new S3Client({
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
  }),
});
```

### 2. Use Feature Flags

```typescript
// Support both Redis and SQS
const queueClient = process.env.USE_SQS === 'true'
  ? new SQSClient()
  : new RedisClient();
```

### 3. Test Both Environments

```bash
# Test with LocalStack
docker-compose -f docker-compose.localstack.yml up
npm test

# Test with AWS (staging)
NODE_ENV=staging npm test
```

---

## Troubleshooting LocalStack

### Problem: S3 buckets not created

```bash
# Check LocalStack logs
docker-compose logs localstack

# Manually create buckets
docker-compose exec localstack awslocal s3 mb s3://media-uploads
```

### Problem: Can't connect to LocalStack from host

```bash
# Use localhost:4566 from host machine
# Use localstack:4566 from Docker containers

# Test from host
curl http://localhost:4566/_localstack/health

# Test from container
docker-compose exec api curl http://localstack:4566/_localstack/health
```

### Problem: Pre-signed URLs don't work

```bash
# LocalStack URLs look like: http://localhost:4566/bucket/key
# Make sure S3_FORCE_PATH_STYLE=true in your config
```

---

## Quick Start Commands

```bash
# 1. Start LocalStack environment
docker-compose -f docker-compose.localstack.yml up -d

# 2. Verify LocalStack is ready
docker-compose exec localstack awslocal s3 ls

# 3. Check all services are healthy
docker-compose ps

# 4. View logs
docker-compose logs -f

# 5. Test upload
curl -X POST http://localhost:8080/jobs \
  -F "file=@test.mp4" \
  -F "job_type=video"

# 6. Stop all services
docker-compose down
```

---

## Cost Savings

**LocalStack Development:**
- Cost: $0/month
- Development: Unlimited free testing

**Real AWS Production:**
- Cost: ~$500-800/month (medium scale)
- Production: Pay only for what you use

**Best of Both Worlds:**
- Develop and test on LocalStack (free)
- Deploy to AWS only when ready
- Easy migration (just env vars)

---

## Next Steps

1. **Set up LocalStack** (30 minutes)
   ```bash
   docker-compose -f docker-compose.localstack.yml up -d
   ```

2. **Build API with AWS SDK** (3-5 days)
   - Works with LocalStack during dev
   - Works with real AWS in production

3. **Build Worker with S3 integration** (3-5 days)
   - Download from LocalStack S3
   - Upload to LocalStack S3

4. **Test end-to-end** (1 day)
   - Upload → Process → Download

5. **When ready, migrate to AWS** (1-2 days)
   - Create AWS resources
   - Update environment variables
   - Deploy!

Ready to start with LocalStack?
