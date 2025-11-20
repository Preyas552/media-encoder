# Worker Processing Logic

## Overview

Workers are stateless, containerized processes that consume jobs from queues, process media files using FFmpeg, and upload results to object storage.

## Worker Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Worker Pod                           │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │   Queue      │───▶│   Job        │                 │
│  │   Consumer   │    │   Validator  │                 │
│  └──────────────┘    └──────┬───────┘                 │
│                              │                          │
│                              ▼                          │
│                      ┌──────────────┐                  │
│                      │   Download   │                  │
│                      │   Manager    │                  │
│                      └──────┬───────┘                  │
│                              │                          │
│                              ▼                          │
│                      ┌──────────────┐                  │
│                      │   FFmpeg     │                  │
│                      │   Processor  │                  │
│                      └──────┬───────┘                  │
│                              │                          │
│                              ▼                          │
│                      ┌──────────────┐                  │
│                      │   Upload     │                  │
│                      │   Manager    │                  │
│                      └──────┬───────┘                  │
│                              │                          │
│                              ▼                          │
│                      ┌──────────────┐                  │
│                      │   Status     │                  │
│                      │   Updater    │                  │
│                      └──────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

## Worker Types

### Video Worker
- **Resources**: 4 vCPU, 8GB RAM, 20GB disk
- **Purpose**: Video transcoding, thumbnail generation
- **Queue**: jobs.video.*
- **Processing Time**: 1-10x video duration

### Image Worker
- **Resources**: 2 vCPU, 4GB RAM, 10GB disk
- **Purpose**: Image resizing, format conversion
- **Queue**: jobs.image.*
- **Processing Time**: 1-5 seconds per image

### Audio Worker
- **Resources**: 1 vCPU, 2GB RAM, 5GB disk
- **Purpose**: Audio transcoding, waveform generation
- **Queue**: jobs.audio.*
- **Processing Time**: 0.1-2x audio duration

---

## Processing Workflow

### Main Processing Loop

```python
import os
import json
import redis
import boto3
import subprocess
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class MediaWorker:
    def __init__(self, worker_type, queue_names):
        self.worker_type = worker_type
        self.queue_names = queue_names
        self.worker_id = os.getenv('HOSTNAME', 'worker-unknown')

        # Initialize clients
        self.redis_client = redis.Redis(host='redis', port=6379)
        self.s3_client = boto3.client('s3')
        self.db_client = self._init_db()

        # Working directory
        self.work_dir = '/tmp/processing'
        os.makedirs(self.work_dir, exist_ok=True)

    def run(self):
        """Main worker loop"""
        logger.info(f"Worker {self.worker_id} starting, listening to {self.queue_names}")

        while True:
            try:
                # Poll queue (blocking with timeout)
                result = self.redis_client.blpop(self.queue_names, timeout=5)

                if result:
                    queue_name, message_data = result
                    message = json.loads(message_data)

                    logger.info(f"Received job {message['job_id']} from {queue_name}")

                    # Process the job
                    self.process_job(message)

            except Exception as e:
                logger.error(f"Error in main loop: {e}", exc_info=True)
                time.sleep(1)

    def process_job(self, message):
        """Process a single job"""
        job_id = message['job_id']

        try:
            # 1. Validate message
            self.validate_message(message)

            # 2. Update status to processing
            self.update_job_status(job_id, 'processing', {
                'worker_id': self.worker_id,
                'started_at': datetime.utcnow().isoformat()
            })

            # 3. Download input file
            input_path = self.download_input(message)

            # 4. Process media
            output_paths = self.process_media(message, input_path)

            # 5. Upload outputs
            output_urls = self.upload_outputs(message, output_paths)

            # 6. Update status to completed
            self.update_job_status(job_id, 'completed', {
                'outputs': output_urls,
                'completed_at': datetime.utcnow().isoformat(),
                'worker_id': self.worker_id
            })

            # 7. Cleanup temp files
            self.cleanup(input_path, output_paths)

            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}", exc_info=True)
            self.handle_failure(message, str(e))

    def validate_message(self, message):
        """Validate message format and required fields"""
        required_fields = ['job_id', 'user_id', 'job_type', 'payload']

        for field in required_fields:
            if field not in message:
                raise ValueError(f"Missing required field: {field}")

        if message['job_type'] not in ['video', 'image', 'audio']:
            raise ValueError(f"Invalid job_type: {message['job_type']}")

    def download_input(self, message):
        """Download input file from S3"""
        payload = message['payload']
        input_info = payload['input']

        # Parse S3 path
        storage_path = input_info['storage_path']
        # Format: s3://bucket/key
        parts = storage_path.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1]

        # Download file
        local_path = os.path.join(self.work_dir, f"{message['job_id']}_input")

        logger.info(f"Downloading {storage_path} to {local_path}")

        self.s3_client.download_file(bucket, key, local_path)

        # Verify file size
        actual_size = os.path.getsize(local_path)
        expected_size = input_info['size_bytes']

        if actual_size != expected_size:
            raise ValueError(f"File size mismatch: expected {expected_size}, got {actual_size}")

        return local_path

    def process_media(self, message, input_path):
        """Process media based on job type"""
        job_type = message['job_type']

        if job_type == 'video':
            return self.process_video(message, input_path)
        elif job_type == 'image':
            return self.process_image(message, input_path)
        elif job_type == 'audio':
            return self.process_audio(message, input_path)
        else:
            raise ValueError(f"Unsupported job type: {job_type}")

    def upload_outputs(self, message, output_paths):
        """Upload all output files to S3"""
        output_urls = []

        for output_info, local_path in output_paths:
            # Parse S3 path
            storage_path = output_info['storage_path']
            parts = storage_path.replace('s3://', '').split('/', 1)
            bucket = parts[0]
            key = parts[1]

            # Upload file
            logger.info(f"Uploading {local_path} to {storage_path}")

            self.s3_client.upload_file(local_path, bucket, key)

            # Generate pre-signed URL (expires in 7 days)
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket, 'Key': key},
                ExpiresIn=604800  # 7 days
            )

            output_urls.append({
                'id': output_info['id'],
                'type': output_info['type'],
                'storage_path': storage_path,
                'url': url,
                'size_bytes': os.path.getsize(local_path)
            })

        return output_urls

    def update_job_status(self, job_id, status, extra_data=None):
        """Update job status in database"""
        update_data = {
            'status': status,
            'updated_at': datetime.utcnow().isoformat()
        }

        if extra_data:
            update_data.update(extra_data)

        # Update database (pseudo-code)
        self.db_client.update_job(job_id, update_data)

        logger.info(f"Job {job_id} status updated to {status}")

    def handle_failure(self, message, error_message):
        """Handle job failure with retry logic"""
        job_id = message['job_id']
        retry_count = message['retry_count']
        max_retries = message['max_retries']

        if retry_count < max_retries:
            # Retry with exponential backoff
            message['retry_count'] += 1
            delay_seconds = 2 ** retry_count * 60

            # Re-queue (with delay implementation depends on queue system)
            self.requeue_with_delay(message, delay_seconds)

            self.update_job_status(job_id, 'queued', {
                'retry_count': retry_count + 1,
                'error_message': error_message
            })

            logger.info(f"Job {job_id} requeued for retry {retry_count + 1}/{max_retries}")
        else:
            # Max retries exceeded
            self.send_to_dlq(message, error_message)

            self.update_job_status(job_id, 'failed', {
                'error_message': error_message,
                'retry_count': retry_count,
                'failed_at': datetime.utcnow().isoformat()
            })

            logger.error(f"Job {job_id} failed after {max_retries} retries")

    def cleanup(self, input_path, output_paths):
        """Clean up temporary files"""
        try:
            if os.path.exists(input_path):
                os.remove(input_path)

            for _, output_path in output_paths:
                if os.path.exists(output_path):
                    os.remove(output_path)
        except Exception as e:
            logger.warning(f"Cleanup error: {e}")
```

---

## Video Processing

```python
def process_video(self, message, input_path):
    """Process video using FFmpeg"""
    payload = message['payload']
    outputs = payload['outputs']
    output_paths = []

    for output_config in outputs:
        if output_config['type'] == 'video':
            output_path = self.transcode_video(input_path, output_config, message)
            output_paths.append((output_config, output_path))

        elif output_config['type'] == 'thumbnail':
            output_path = self.generate_thumbnail(input_path, output_config, message)
            output_paths.append((output_config, output_path))

    return output_paths

def transcode_video(self, input_path, output_config, message):
    """Transcode video to specified format/resolution"""
    job_id = message['job_id']
    output_path = os.path.join(self.work_dir, f"{job_id}_{output_config['id']}.{output_config['format']}")

    # Build FFmpeg command
    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-c:v', output_config.get('codec', 'libx264'),
        '-b:v', str(output_config.get('bitrate_kbps', 5000)) + 'k',
        '-s', self._resolution_to_size(output_config['resolution']),
        '-r', str(output_config.get('fps', 30)),
        '-c:a', output_config.get('audio_codec', 'aac'),
        '-b:a', str(output_config.get('audio_bitrate_kbps', 128)) + 'k',
        '-movflags', '+faststart',  # Enable progressive playback
        '-y',  # Overwrite output
        output_path
    ]

    logger.info(f"Running FFmpeg: {' '.join(cmd)}")

    # Run FFmpeg with progress tracking
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True
    )

    # Monitor progress
    duration = message['payload']['input']['duration_seconds']

    for line in process.stderr:
        # Parse FFmpeg progress output
        if 'time=' in line:
            time_str = self._extract_time(line)
            current_seconds = self._time_to_seconds(time_str)
            progress = min(int((current_seconds / duration) * 100), 100)

            # Update progress in database (throttled)
            if progress % 5 == 0:  # Update every 5%
                self.update_job_progress(message['job_id'], progress)

    # Wait for completion
    return_code = process.wait()

    if return_code != 0:
        stderr = process.stderr.read()
        raise RuntimeError(f"FFmpeg failed with code {return_code}: {stderr}")

    logger.info(f"Video transcoding completed: {output_path}")

    return output_path

def generate_thumbnail(self, input_path, output_config, message):
    """Generate video thumbnail"""
    job_id = message['job_id']
    output_path = os.path.join(self.work_dir, f"{job_id}_thumbnail.{output_config['format']}")

    timestamp = output_config.get('timestamp', '00:00:05')

    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-ss', timestamp,
        '-vframes', '1',
        '-s', f"{output_config.get('width', 1280)}x{output_config.get('height', 720)}",
        '-q:v', str(100 - output_config.get('quality', 85)),  # Quality 85 = q:v 15
        '-y',
        output_path
    ]

    subprocess.run(cmd, check=True, capture_output=True)

    logger.info(f"Thumbnail generated: {output_path}")

    return output_path

def _resolution_to_size(self, resolution):
    """Convert resolution preset to FFmpeg size format"""
    resolutions = {
        '2160p': '3840x2160',
        '1440p': '2560x1440',
        '1080p': '1920x1080',
        '720p': '1280x720',
        '480p': '854x480',
        '360p': '640x360'
    }
    return resolutions.get(resolution, resolution)
```

---

## Image Processing

```python
def process_image(self, message, input_path):
    """Process image using FFmpeg/ImageMagick"""
    payload = message['payload']
    outputs = payload['outputs']
    output_paths = []

    for output_config in outputs:
        output_path = self.resize_image(input_path, output_config, message)
        output_paths.append((output_config, output_path))

    return output_paths

def resize_image(self, input_path, output_config, message):
    """Resize/convert image"""
    job_id = message['job_id']
    output_path = os.path.join(
        self.work_dir,
        f"{job_id}_{output_config['id']}.{output_config['format']}"
    )

    # Using FFmpeg for image processing
    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-vf', f"scale={output_config['width']}:{output_config['height']}",
        '-q:v', str(100 - output_config.get('quality', 85)),
        '-y',
        output_path
    ]

    # Apply processing options
    options = message['payload'].get('processing_options', {})

    if options.get('auto_orient', True):
        # Auto-rotate based on EXIF
        cmd.insert(2, '-auto_orient')

    if options.get('strip_metadata', True):
        cmd.extend(['-map_metadata', '-1'])

    subprocess.run(cmd, check=True, capture_output=True)

    logger.info(f"Image processed: {output_path}")

    return output_path
```

---

## Audio Processing

```python
def process_audio(self, message, input_path):
    """Process audio using FFmpeg"""
    payload = message['payload']
    outputs = payload['outputs']
    output_paths = []

    for output_config in outputs:
        if output_config['type'] == 'audio':
            output_path = self.transcode_audio(input_path, output_config, message)
            output_paths.append((output_config, output_path))

        elif output_config['type'] == 'waveform':
            output_path = self.generate_waveform(input_path, output_config, message)
            output_paths.append((output_config, output_path))

    return output_paths

def transcode_audio(self, input_path, output_config, message):
    """Transcode audio to specified format"""
    job_id = message['job_id']
    output_path = os.path.join(
        self.work_dir,
        f"{job_id}_{output_config['id']}.{output_config['format']}"
    )

    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-b:a', str(output_config.get('bitrate_kbps', 128)) + 'k',
        '-ar', str(output_config.get('sample_rate', 44100)),
        '-ac', str(output_config.get('channels', 2)),
        '-y',
        output_path
    ]

    # Apply processing options
    options = message['payload'].get('processing_options', {})

    if options.get('normalize', False):
        cmd.extend(['-af', 'loudnorm'])

    subprocess.run(cmd, check=True, capture_output=True)

    logger.info(f"Audio transcoded: {output_path}")

    return output_path

def generate_waveform(self, input_path, output_config, message):
    """Generate audio waveform visualization"""
    job_id = message['job_id']
    output_path = os.path.join(self.work_dir, f"{job_id}_waveform.png")

    width = output_config.get('width', 1800)
    height = output_config.get('height', 200)

    cmd = [
        'ffmpeg',
        '-i', input_path,
        '-filter_complex',
        f'[0:a]showwavespic=s={width}x{height}:colors=#3b82f6[fg]',
        '-map', '[fg]',
        '-frames:v', '1',
        '-y',
        output_path
    ]

    subprocess.run(cmd, check=True, capture_output=True)

    logger.info(f"Waveform generated: {output_path}")

    return output_path
```

---

## Error Handling

### Transient Errors (Retry)

- Network timeouts downloading from S3
- Temporary S3 unavailability
- Database connection errors
- Queue connection errors

### Permanent Errors (Fail Immediately)

- Corrupted input file
- Unsupported codec
- Invalid FFmpeg parameters
- File not found in S3
- Insufficient disk space

### Error Classification

```python
def classify_error(self, error):
    """Classify error as transient or permanent"""
    error_str = str(error).lower()

    # Transient errors (retry)
    transient_patterns = [
        'timeout',
        'connection reset',
        'temporary failure',
        'service unavailable',
        '503',
        '504'
    ]

    for pattern in transient_patterns:
        if pattern in error_str:
            return 'transient'

    # Permanent errors (fail immediately)
    return 'permanent'
```

---

## Health Checks

```python
def health_check(self):
    """Worker health check endpoint"""
    health = {
        'worker_id': self.worker_id,
        'worker_type': self.worker_type,
        'status': 'healthy',
        'checks': {}
    }

    # Check queue connection
    try:
        self.redis_client.ping()
        health['checks']['queue'] = 'ok'
    except:
        health['checks']['queue'] = 'failed'
        health['status'] = 'unhealthy'

    # Check S3 connection
    try:
        self.s3_client.list_buckets()
        health['checks']['storage'] = 'ok'
    except:
        health['checks']['storage'] = 'failed'
        health['status'] = 'unhealthy'

    # Check disk space
    disk_usage = shutil.disk_usage(self.work_dir)
    free_gb = disk_usage.free / (1024**3)

    if free_gb < 1:  # Less than 1GB free
        health['checks']['disk'] = 'low'
        health['status'] = 'degraded'
    else:
        health['checks']['disk'] = 'ok'

    return health
```

---

## Performance Optimization

### 1. Parallel Processing

For large videos, process multiple outputs in parallel:

```python
from concurrent.futures import ThreadPoolExecutor

def process_video_parallel(self, message, input_path):
    """Process multiple video outputs in parallel"""
    payload = message['payload']
    outputs = payload['outputs']

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = []

        for output_config in outputs:
            future = executor.submit(
                self.transcode_video,
                input_path,
                output_config,
                message
            )
            futures.append((output_config, future))

        output_paths = []
        for output_config, future in futures:
            output_path = future.result()
            output_paths.append((output_config, output_path))

        return output_paths
```

### 2. Disk I/O Optimization

Use tmpfs (in-memory filesystem) for processing:

```yaml
# Kubernetes pod spec
volumes:
  - name: processing-tmpfs
    emptyDir:
      medium: Memory
      sizeLimit: 4Gi
```

### 3. FFmpeg Hardware Acceleration

```python
# NVIDIA GPU acceleration
cmd = [
    'ffmpeg',
    '-hwaccel', 'cuda',
    '-i', input_path,
    '-c:v', 'h264_nvenc',  # NVIDIA hardware encoder
    ...
]

# Intel Quick Sync
cmd = [
    'ffmpeg',
    '-hwaccel', 'qsv',
    '-c:v', 'h264_qsv',
    ...
]
```

---

## Monitoring and Metrics

```python
from prometheus_client import Counter, Histogram, Gauge

# Metrics
jobs_processed = Counter('jobs_processed_total', 'Total jobs processed', ['job_type', 'status'])
processing_duration = Histogram('processing_duration_seconds', 'Job processing duration', ['job_type'])
active_jobs = Gauge('active_jobs', 'Currently processing jobs', ['worker_id'])

# Update metrics
jobs_processed.labels(job_type='video', status='success').inc()
processing_duration.labels(job_type='video').observe(duration_seconds)
active_jobs.labels(worker_id=self.worker_id).set(1)
```

---

## Graceful Shutdown

```python
import signal

class MediaWorker:
    def __init__(self):
        self.shutdown_requested = False
        signal.signal(signal.SIGTERM, self.handle_shutdown)
        signal.signal(signal.SIGINT, self.handle_shutdown)

    def handle_shutdown(self, signum, frame):
        """Handle graceful shutdown"""
        logger.info("Shutdown signal received, finishing current job...")
        self.shutdown_requested = True

    def run(self):
        while not self.shutdown_requested:
            # Process jobs
            ...

        logger.info("Worker shutting down gracefully")
```
