# Queue Message Specification

## Overview

The message queue is the central nervous system of the media encoder. It decouples the API service from processing workers, enabling horizontal scaling and fault tolerance.

## Queue Architecture

### Queue Structure

```
Priority Queues (Separate queues for isolation):
├── jobs.video.high          (Video processing - high priority)
├── jobs.video.normal        (Video processing - normal priority)
├── jobs.video.low           (Video processing - low priority)
├── jobs.image.high          (Image processing - high priority)
├── jobs.image.normal        (Image processing - normal priority)
├── jobs.audio.high          (Audio processing - high priority)
├── jobs.audio.normal        (Audio processing - normal priority)
└── jobs.dlq                 (Dead letter queue - failed jobs)
```

### Queue Selection Logic

```
Queue Name = "jobs.{job_type}.{priority}"

Examples:
- Video, high priority → jobs.video.high
- Image, normal priority → jobs.image.normal
- Audio, low priority → jobs.audio.low
```

---

## Message Format

### Base Message Structure

All messages follow this JSON structure:

```json
{
  "version": "1.0",
  "message_id": "msg_abc123xyz",
  "job_id": "job_550e8400-e29b-41d4-a716-446655440000",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "job_type": "video",
  "priority": "normal",
  "retry_count": 0,
  "max_retries": 3,
  "created_at": "2025-01-17T10:30:00Z",
  "payload": {
    ... // Job-specific payload
  },
  "metadata": {
    "source": "api",
    "api_version": "v1",
    "client_ip": "192.168.1.100"
  }
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string | Yes | Message format version (for compatibility) |
| message_id | string | Yes | Unique message identifier |
| job_id | string | Yes | Job UUID from database |
| user_id | string | Yes | User UUID |
| job_type | string | Yes | video, image, or audio |
| priority | string | Yes | high, normal, or low |
| retry_count | integer | Yes | Current retry attempt (0 for first try) |
| max_retries | integer | Yes | Maximum retry attempts |
| created_at | string | Yes | ISO 8601 timestamp |
| payload | object | Yes | Job-specific data |
| metadata | object | No | Additional context |

---

## Payload Formats by Job Type

### Video Processing Payload

```json
{
  "payload": {
    "input": {
      "storage_path": "s3://media-uploads/user123/job456/original.mp4",
      "presigned_url": "https://s3.amazonaws.com/media-uploads/...",
      "presigned_url_expires_at": "2025-01-17T12:00:00Z",
      "filename": "my_video.mp4",
      "size_bytes": 104857600,
      "format": "mp4",
      "duration_seconds": 120.5,
      "resolution": "1920x1080",
      "codec": "h264",
      "bitrate_kbps": 5000,
      "fps": 30
    },
    "outputs": [
      {
        "id": "output_1",
        "type": "video",
        "resolution": "1920x1080",
        "format": "mp4",
        "codec": "h264",
        "bitrate_kbps": 8000,
        "fps": 30,
        "audio_codec": "aac",
        "audio_bitrate_kbps": 192,
        "storage_path": "s3://media-processed/user123/job456/1080p.mp4"
      },
      {
        "id": "output_2",
        "type": "video",
        "resolution": "1280x720",
        "format": "mp4",
        "codec": "h264",
        "bitrate_kbps": 5000,
        "fps": 30,
        "audio_codec": "aac",
        "audio_bitrate_kbps": 128,
        "storage_path": "s3://media-processed/user123/job456/720p.mp4"
      },
      {
        "id": "output_3",
        "type": "thumbnail",
        "timestamp": "00:00:05",
        "format": "jpg",
        "width": 1280,
        "height": 720,
        "quality": 85,
        "storage_path": "s3://media-processed/user123/job456/thumbnail.jpg"
      }
    ],
    "processing_options": {
      "deinterlace": false,
      "normalize_audio": true,
      "remove_metadata": false,
      "watermark": null,
      "segment_duration_seconds": null
    }
  }
}
```

### Image Processing Payload

```json
{
  "payload": {
    "input": {
      "storage_path": "s3://media-uploads/user123/job789/image.jpg",
      "presigned_url": "https://s3.amazonaws.com/media-uploads/...",
      "presigned_url_expires_at": "2025-01-17T12:00:00Z",
      "filename": "photo.jpg",
      "size_bytes": 5242880,
      "format": "jpeg",
      "width": 4000,
      "height": 3000,
      "color_space": "RGB"
    },
    "outputs": [
      {
        "id": "output_1",
        "type": "image",
        "format": "webp",
        "width": 1920,
        "height": 1440,
        "quality": 85,
        "storage_path": "s3://media-processed/user123/job789/large.webp"
      },
      {
        "id": "output_2",
        "type": "image",
        "format": "webp",
        "width": 800,
        "height": 600,
        "quality": 80,
        "storage_path": "s3://media-processed/user123/job789/medium.webp"
      },
      {
        "id": "output_3",
        "type": "image",
        "format": "webp",
        "width": 200,
        "height": 150,
        "quality": 75,
        "storage_path": "s3://media-processed/user123/job789/thumbnail.webp"
      }
    ],
    "processing_options": {
      "auto_orient": true,
      "strip_metadata": true,
      "optimize": true,
      "sharpen": false,
      "preserve_alpha": true
    }
  }
}
```

### Audio Processing Payload

```json
{
  "payload": {
    "input": {
      "storage_path": "s3://media-uploads/user123/job321/audio.wav",
      "presigned_url": "https://s3.amazonaws.com/media-uploads/...",
      "presigned_url_expires_at": "2025-01-17T12:00:00Z",
      "filename": "podcast.wav",
      "size_bytes": 52428800,
      "format": "wav",
      "duration_seconds": 1800,
      "sample_rate": 44100,
      "channels": 2,
      "bitrate_kbps": 1411
    },
    "outputs": [
      {
        "id": "output_1",
        "type": "audio",
        "format": "mp3",
        "bitrate_kbps": 320,
        "sample_rate": 44100,
        "channels": 2,
        "storage_path": "s3://media-processed/user123/job321/high.mp3"
      },
      {
        "id": "output_2",
        "type": "audio",
        "format": "mp3",
        "bitrate_kbps": 128,
        "sample_rate": 44100,
        "channels": 2,
        "storage_path": "s3://media-processed/user123/job321/standard.mp3"
      },
      {
        "id": "output_3",
        "type": "waveform",
        "format": "png",
        "width": 1800,
        "height": 200,
        "storage_path": "s3://media-processed/user123/job321/waveform.png"
      }
    ],
    "processing_options": {
      "normalize": true,
      "noise_reduction": false,
      "fade_in_seconds": 0,
      "fade_out_seconds": 0,
      "remove_silence": false
    }
  }
}
```

---

## Message Lifecycle

### 1. Message Publication (API Service)

```python
import json
import redis
import uuid
from datetime import datetime

def publish_job(job_data):
    # Generate unique message ID
    message_id = f"msg_{uuid.uuid4().hex}"

    # Construct message
    message = {
        "version": "1.0",
        "message_id": message_id,
        "job_id": job_data["job_id"],
        "user_id": job_data["user_id"],
        "job_type": job_data["job_type"],
        "priority": job_data["priority"],
        "retry_count": 0,
        "max_retries": 3,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "payload": job_data["payload"],
        "metadata": {
            "source": "api",
            "api_version": "v1"
        }
    }

    # Determine queue name
    queue_name = f"jobs.{job_data['job_type']}.{job_data['priority']}"

    # Publish to Redis
    redis_client = redis.Redis(host='redis', port=6379)
    redis_client.rpush(queue_name, json.dumps(message))

    # Update job status in database
    update_job_status(job_data["job_id"], "queued")

    return message_id
```

### 2. Message Consumption (Worker)

```python
import json
import redis
import time

def consume_messages(queue_name, visibility_timeout=300):
    redis_client = redis.Redis(host='redis', port=6379)

    while True:
        # Blocking pop with timeout
        result = redis_client.blpop(queue_name, timeout=5)

        if result:
            queue, message_data = result
            message = json.loads(message_data)

            try:
                # Process the job
                process_job(message)

                # Message automatically removed (already popped)

            except Exception as e:
                # Handle failure
                handle_job_failure(message, str(e))

        time.sleep(0.1)
```

### 3. Message Retry Logic

```python
def handle_job_failure(message, error):
    retry_count = message["retry_count"]
    max_retries = message["max_retries"]

    if retry_count < max_retries:
        # Retry with exponential backoff
        message["retry_count"] += 1

        # Calculate backoff delay (exponential: 2^retry_count minutes)
        delay_seconds = 2 ** retry_count * 60

        # Re-queue with delay
        schedule_retry(message, delay_seconds)

        # Update job status
        update_job_status(message["job_id"], "queued", {
            "retry_count": retry_count + 1,
            "error_message": error
        })
    else:
        # Max retries exceeded, send to DLQ
        send_to_dlq(message, error)

        # Update job status to failed
        update_job_status(message["job_id"], "failed", {
            "error_message": error,
            "retry_count": retry_count
        })
```

---

## Queue Implementation Options

### Option A: Redis (Simple, Fast)

**Pros:**
- Fast (in-memory)
- Simple to set up
- Low latency

**Cons:**
- Limited persistence
- No native retry/DLQ
- Manual implementation needed

**Configuration:**

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  command: redis-server --appendonly yes
  volumes:
    - redis-data:/data
```

**Usage:**

```python
import redis

# Connect
client = redis.Redis(host='redis', port=6379, decode_responses=True)

# Publish
client.rpush('jobs.video.normal', json.dumps(message))

# Consume
message = client.blpop('jobs.video.normal', timeout=5)
```

---

### Option B: RabbitMQ (Robust, Feature-Rich)

**Pros:**
- Native retry/DLQ support
- Message acknowledgment
- Clustering support
- Priority queues

**Cons:**
- More complex to operate
- Higher resource usage

**Configuration:**

```yaml
# docker-compose.yml
rabbitmq:
  image: rabbitmq:3-management-alpine
  ports:
    - "5672:5672"
    - "15672:15672"  # Management UI
  environment:
    RABBITMQ_DEFAULT_USER: admin
    RABBITMQ_DEFAULT_PASS: password
  volumes:
    - rabbitmq-data:/var/lib/rabbitmq
```

**Queue Setup:**

```python
import pika
import json

# Connect
connection = pika.BlockingConnection(
    pika.ConnectionParameters(host='rabbitmq')
)
channel = connection.channel()

# Declare queue with DLQ
channel.queue_declare(
    queue='jobs.video.normal',
    durable=True,
    arguments={
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'jobs.dlq',
        'x-message-ttl': 3600000  # 1 hour TTL
    }
)

# Publish
channel.basic_publish(
    exchange='',
    routing_key='jobs.video.normal',
    body=json.dumps(message),
    properties=pika.BasicProperties(
        delivery_mode=2,  # Persistent
        priority=message['priority_value']
    )
)

# Consume
def callback(ch, method, properties, body):
    message = json.loads(body)
    try:
        process_job(message)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        # Negative ack with requeue
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

channel.basic_consume(
    queue='jobs.video.normal',
    on_message_callback=callback,
    auto_ack=False
)

channel.start_consuming()
```

---

### Option C: Kafka (High Throughput, Event Streaming)

**Pros:**
- Very high throughput
- Message replay capability
- Partitioning for parallelism
- Event sourcing support

**Cons:**
- Complex to set up
- Overkill for small scale
- Higher resource usage

**Configuration:**

```yaml
# docker-compose.yml
zookeeper:
  image: confluentinc/cp-zookeeper:latest
  environment:
    ZOOKEEPER_CLIENT_PORT: 2181

kafka:
  image: confluentinc/cp-kafka:latest
  depends_on:
    - zookeeper
  ports:
    - "9092:9092"
  environment:
    KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
```

**Usage:**

```python
from kafka import KafkaProducer, KafkaConsumer
import json

# Producer
producer = KafkaProducer(
    bootstrap_servers=['kafka:9092'],
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

producer.send('jobs.video.normal', message)

# Consumer
consumer = KafkaConsumer(
    'jobs.video.normal',
    bootstrap_servers=['kafka:9092'],
    value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    auto_offset_reset='earliest',
    enable_auto_commit=False,
    group_id='video-workers'
)

for msg in consumer:
    message = msg.value
    try:
        process_job(message)
        consumer.commit()
    except Exception as e:
        # Handle error
        pass
```

---

## Queue Monitoring

### Key Metrics to Monitor

1. **Queue Depth**: Number of pending messages
2. **Message Age**: Time since oldest message was enqueued
3. **Throughput**: Messages/second processed
4. **Error Rate**: Failed messages / total messages
5. **Worker Count**: Active workers per queue

### Redis Monitoring

```python
import redis

client = redis.Redis()

# Queue depth
depth = client.llen('jobs.video.normal')

# Monitor all queues
queue_stats = {}
for queue in ['jobs.video.high', 'jobs.video.normal', 'jobs.image.normal']:
    queue_stats[queue] = {
        'depth': client.llen(queue),
        'type': client.type(queue)
    }
```

### RabbitMQ Monitoring

```bash
# Management API
curl -u admin:password http://localhost:15672/api/queues

# CLI
rabbitmqctl list_queues name messages consumers
```

### Prometheus Metrics Export

```python
from prometheus_client import Gauge, Counter

# Define metrics
queue_depth = Gauge('queue_depth', 'Current queue depth', ['queue_name'])
messages_processed = Counter('messages_processed_total', 'Total messages processed', ['queue_name', 'status'])

# Update metrics
queue_depth.labels(queue_name='jobs.video.normal').set(depth)
messages_processed.labels(queue_name='jobs.video.normal', status='success').inc()
```

---

## Dead Letter Queue (DLQ)

### Purpose

Stores messages that:
- Exceeded max retry attempts
- Caused worker crashes
- Invalid message format
- Permanent processing errors

### DLQ Message Format

```json
{
  "original_message": { ... },
  "failure_info": {
    "error_message": "FFmpeg process crashed",
    "error_type": "ProcessingError",
    "failed_at": "2025-01-17T10:45:00Z",
    "retry_count": 3,
    "worker_id": "worker-video-abc123"
  },
  "dlq_metadata": {
    "added_to_dlq_at": "2025-01-17T10:50:00Z",
    "requires_manual_review": true
  }
}
```

### DLQ Processing

```python
def process_dlq():
    """
    Periodic job to review DLQ messages
    """
    redis_client = redis.Redis()

    # Get all DLQ messages
    dlq_messages = redis_client.lrange('jobs.dlq', 0, -1)

    for msg_data in dlq_messages:
        msg = json.loads(msg_data)

        # Analyze failure
        if is_transient_error(msg):
            # Retry after fixing issue
            requeue_job(msg['original_message'])
        else:
            # Notify user of permanent failure
            notify_user_failure(msg)

            # Archive message
            archive_dlq_message(msg)
```

---

## Best Practices

1. **Message Idempotency**: Ensure processing the same message twice has no adverse effects
2. **Timeouts**: Set reasonable visibility timeouts (5-30 minutes for video)
3. **Monitoring**: Alert on queue depth > threshold
4. **Partitioning**: Use separate queues for different job types
5. **Priority**: Use priority queues for urgent jobs
6. **Retry Strategy**: Exponential backoff with max retries
7. **DLQ Processing**: Review DLQ daily
8. **Message TTL**: Set TTL to prevent queue bloat (24 hours recommended)
9. **Compression**: Compress large payloads if needed
10. **Schema Versioning**: Include version field for backwards compatibility
