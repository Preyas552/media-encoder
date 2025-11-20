# Getting Started - Media Encoder Backend

## 🚀 Initialize Backend Infrastructure (Today)

This guide will get your backend infrastructure running locally using LocalStack in **under 30 minutes**.

---

## Prerequisites

Install these on your machine:

```bash
# Docker and Docker Compose
docker --version  # Should be 20.10+
docker-compose --version  # Should be 1.29+

# Node.js (for API)
node --version  # Should be 18+
npm --version

# Python (for Worker)
python3 --version  # Should be 3.9+
pip3 --version

# AWS CLI (optional, for testing)
pip install awscli-local
```

---

## Step 1: Create Docker Compose (5 minutes)

Create `docker-compose.yml` in the project root:

```yaml
version: '3.8'

services:
  # LocalStack - AWS Emulator
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=s3,sqs,sns
      - DEBUG=1
      - AWS_DEFAULT_REGION=us-east-1
      - AWS_ACCESS_KEY_ID=test
      - AWS_SECRET_ACCESS_KEY=test
    volumes:
      - "./scripts/init-localstack.sh:/etc/localstack/init/ready.d/init.sh"
      - "/tmp/localstack:/tmp/localstack"

  # PostgreSQL
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: media_encoder
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
```

---

## Step 2: Create LocalStack Init Script (2 minutes)

Create `scripts/init-localstack.sh`:

```bash
#!/bin/bash

echo "🚀 Initializing LocalStack..."

# Create S3 buckets
awslocal s3 mb s3://media-uploads
awslocal s3 mb s3://media-processed
awslocal s3 mb s3://media-temp

echo "✅ LocalStack ready!"
echo "📦 Created buckets: media-uploads, media-processed, media-temp"
```

Make it executable:

```bash
mkdir -p scripts
chmod +x scripts/init-localstack.sh
```

---

## Step 3: Start Infrastructure (2 minutes)

```bash
# Start all services
docker-compose up -d

# Wait 10 seconds for LocalStack to initialize
sleep 10

# Check everything is running
docker-compose ps

# Expected output:
# NAME                SERVICE      STATUS
# localstack          localstack   Up (healthy)
# postgres            postgres     Up
# redis               redis        Up
```

---

## Step 4: Verify Services (5 minutes)

### Test PostgreSQL

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U postgres -d media_encoder

# Inside psql, run:
\dt  # Should show empty (no tables yet)
\q   # Exit
```

### Test Redis

```bash
# Test Redis
docker-compose exec redis redis-cli ping
# Should return: PONG
```

### Test LocalStack S3

```bash
# List S3 buckets
awslocal s3 ls

# Expected output:
# 2025-01-17 10:00:00 media-uploads
# 2025-01-17 10:00:00 media-processed
# 2025-01-17 10:00:00 media-temp

# Upload test file
echo "Hello LocalStack!" > test.txt
awslocal s3 cp test.txt s3://media-uploads/test.txt

# Download to verify
awslocal s3 cp s3://media-uploads/test.txt downloaded.txt
cat downloaded.txt
# Should output: Hello LocalStack!
```

---

## Step 5: Initialize Database Schema (5 minutes)

Create `migrations/001_init.sql`:

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    api_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Jobs table
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    job_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    input_filename VARCHAR(255) NOT NULL,
    input_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

Run migration:

```bash
# Copy SQL file into container and execute
docker-compose exec -T postgres psql -U postgres -d media_encoder < migrations/001_init.sql

# Verify tables were created
docker-compose exec postgres psql -U postgres -d media_encoder -c "\dt"

# Expected output:
#  Schema |  Name  | Type  |  Owner
# --------+--------+-------+----------
#  public | jobs   | table | postgres
#  public | users  | table | postgres
```

---

## Step 6: Create Environment File (2 minutes)

Create `.env`:

```bash
# API Configuration
NODE_ENV=development
PORT=8080

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/media_encoder

# Redis
REDIS_URL=redis://localhost:6379

# LocalStack (AWS Emulator)
AWS_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# S3 Buckets
S3_BUCKET_UPLOADS=media-uploads
S3_BUCKET_PROCESSED=media-processed
S3_FORCE_PATH_STYLE=true
```

---

## Step 7: Quick Test (5 minutes)

### Test Database Connection

Create `test-db.js`:

```javascript
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/media_encoder'
});

async function test() {
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    const result = await client.query('SELECT NOW()');
    console.log('⏰ Server time:', result.rows[0].now);

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
```

Run:

```bash
npm install pg
node test-db.js
# Should output: ✅ Connected to PostgreSQL
```

### Test S3 Connection

Create `test-s3.js`:

```javascript
const { S3Client, ListBucketsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  },
  forcePathStyle: true
});

async function test() {
  try {
    // List buckets
    const listResult = await s3.send(new ListBucketsCommand({}));
    console.log('✅ S3 buckets:', listResult.Buckets.map(b => b.Name));

    // Upload file
    await s3.send(new PutObjectCommand({
      Bucket: 'media-uploads',
      Key: 'test-from-sdk.txt',
      Body: 'Hello from AWS SDK!'
    }));
    console.log('✅ Uploaded test file to S3');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
```

Run:

```bash
npm install @aws-sdk/client-s3
node test-s3.js
# Should output: ✅ S3 buckets: [ 'media-uploads', 'media-processed', 'media-temp' ]
```

---

## ✅ Success Checklist

After completing all steps, verify:

- [ ] Docker containers are running (`docker-compose ps`)
- [ ] PostgreSQL is accessible (`psql` connection works)
- [ ] Redis is responding (`PING` returns `PONG`)
- [ ] LocalStack S3 buckets exist (`awslocal s3 ls`)
- [ ] Database tables are created (`\dt` shows tables)
- [ ] Can upload to S3 (test-s3.js works)
- [ ] Can query database (test-db.js works)

---

## 🎯 What You Have Now

### Infrastructure ✅
- **PostgreSQL**: Running on port 5432
- **Redis**: Running on port 6379
- **LocalStack S3**: Running on port 4566
- **Database Schema**: users and jobs tables created

### Ready to Build
- API can connect to database
- API can upload files to S3
- Workers can download from S3
- Queue system (Redis) ready

---

## 🚀 Next Steps

### Option 1: Build API First (Recommended)

1. **Create basic API server** (1 day)
   - Express.js with TypeScript
   - Health check endpoint
   - Database connection

2. **Add upload endpoint** (1-2 days)
   - `POST /jobs` - Accept file uploads
   - Upload to LocalStack S3
   - Create job record in database

3. **Add status endpoint** (1 day)
   - `GET /jobs/:id` - Get job status
   - Query from database

### Option 2: Build Worker First

1. **Create basic worker** (1 day)
   - Python script
   - Poll Redis queue
   - Log received jobs

2. **Add FFmpeg processing** (2-3 days)
   - Download from S3
   - Transcode video
   - Upload to S3

---

## 📚 Useful Commands

```bash
# Start infrastructure
docker-compose up -d

# View logs
docker-compose logs -f

# Stop infrastructure
docker-compose down

# Restart single service
docker-compose restart localstack

# Access PostgreSQL
docker-compose exec postgres psql -U postgres -d media_encoder

# Access Redis CLI
docker-compose exec redis redis-cli

# Check LocalStack health
curl http://localhost:4566/_localstack/health | jq

# List S3 buckets
awslocal s3 ls

# View bucket contents
awslocal s3 ls s3://media-uploads/
```

---

## 🐛 Troubleshooting

### Problem: LocalStack not starting

```bash
# Check logs
docker-compose logs localstack

# Restart LocalStack
docker-compose restart localstack

# Wait for it to be ready
sleep 10
awslocal s3 ls
```

### Problem: Can't connect to PostgreSQL

```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Test connection
docker-compose exec postgres psql -U postgres -c "SELECT 1"
```

### Problem: S3 uploads fail

```bash
# Make sure S3_FORCE_PATH_STYLE=true in your .env

# Test manually
awslocal s3 cp test.txt s3://media-uploads/test.txt

# Check LocalStack logs
docker-compose logs localstack | grep ERROR
```

---

## 💡 Tips

1. **Keep it running**: Leave `docker-compose up -d` running during development
2. **Check logs often**: `docker-compose logs -f` shows real-time logs
3. **Reset if needed**: `docker-compose down -v` removes all data (fresh start)
4. **Use env files**: Never hardcode credentials, always use `.env`

---

## ⏭️ What's Next?

Once your infrastructure is running, choose your path:

**Path A: API-First Development**
```
Day 1-2: Basic API with health check
Day 3-4: File upload endpoint
Day 5: Job status endpoints
Day 6-7: Integration with Worker
```

**Path B: Worker-First Development**
```
Day 1-2: Basic worker that polls queue
Day 3-5: FFmpeg video processing
Day 6: S3 upload/download
Day 7: Integration with API
```

**I recommend Path A** - build the API first, then add workers.

Ready to start building? Let me know which path you want to take and I'll create the code!
