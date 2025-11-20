# API Specification

## Base URL

```
Production: https://api.media-encoder.com/v1
Staging: https://api-staging.media-encoder.com/v1
Local: http://localhost:8080/v1
```

## Authentication

All API requests require authentication using one of these methods:

### 1. API Key (Recommended for programmatic access)

```http
Authorization: Bearer <api_key>
```

### 2. JWT Token (For web applications)

```http
Authorization: Bearer <jwt_token>
```

### Getting an API Key

```bash
POST /auth/api-keys
```

---

## Common Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2025-01-17T10:30:00Z",
    "request_id": "req_abc123"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FILE_FORMAT",
    "message": "Unsupported file format. Supported formats: mp4, mov, avi",
    "details": {
      "field": "file",
      "provided": "file.mkv",
      "allowed": ["mp4", "mov", "avi"]
    }
  },
  "meta": {
    "timestamp": "2025-01-17T10:30:00Z",
    "request_id": "req_abc123"
  }
}
```

### HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful request |
| 201 | Created | Resource created successfully |
| 202 | Accepted | Request accepted, processing async |
| 400 | Bad Request | Invalid input data |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource conflict (e.g., duplicate) |
| 422 | Unprocessable Entity | Validation error |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service temporarily down |

---

## Endpoints

### Authentication

#### Register User

```http
POST /auth/register
```

**Request Body:**

```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecurePassword123!"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "johndoe",
    "tier": "free",
    "api_key": "sk_live_abc123xyz789",
    "created_at": "2025-01-17T10:30:00Z"
  }
}
```

---

#### Login

```http
POST /auth/login
```

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "username": "johndoe",
      "tier": "free"
    }
  }
}
```

---

### Jobs

#### Upload File and Create Job

```http
POST /jobs
Content-Type: multipart/form-data
```

**Request (Multipart Form):**

```
file: [binary file data]
job_type: "video"
priority: "normal"  (optional: high, normal, low)
preset: "youtube_standard"  (optional: preset name or custom config)
config: "{...}"  (optional: custom processing config as JSON string)
webhook_url: "https://example.com/webhook"  (optional)
```

**Alternatively, JSON body with file URL:**

```http
POST /jobs
Content-Type: application/json
```

```json
{
  "input_url": "https://example.com/video.mp4",
  "job_type": "video",
  "priority": "normal",
  "config": {
    "outputs": [
      {
        "resolution": "1080p",
        "format": "mp4",
        "bitrate": "5000k"
      },
      {
        "resolution": "720p",
        "format": "mp4",
        "bitrate": "2500k"
      }
    ],
    "thumbnail": {
      "enabled": true,
      "timestamp": "00:00:05",
      "format": "jpg"
    }
  },
  "webhook_url": "https://example.com/webhook"
}
```

**Response:** `202 Accepted`

```json
{
  "success": true,
  "data": {
    "job_id": "job_abc123",
    "status": "pending",
    "input": {
      "filename": "video.mp4",
      "size_bytes": 104857600,
      "format": "mp4",
      "duration_seconds": 120.5,
      "resolution": "1920x1080"
    },
    "config": {
      "outputs": [ ... ]
    },
    "estimated_completion_time": "2025-01-17T10:45:00Z",
    "estimated_cost_usd": 0.15,
    "created_at": "2025-01-17T10:30:00Z"
  }
}
```

---

#### Get Job Status

```http
GET /jobs/{job_id}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "job_id": "job_abc123",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing",
    "progress_percentage": 45,
    "input": {
      "filename": "video.mp4",
      "size_bytes": 104857600,
      "format": "mp4",
      "duration_seconds": 120.5,
      "resolution": "1920x1080",
      "storage_path": "s3://media-uploads/..."
    },
    "outputs": [
      {
        "type": "video",
        "resolution": "1080p",
        "format": "mp4",
        "size_bytes": 87654321,
        "url": "https://cdn.media-encoder.com/output/job_abc123/1080p.mp4",
        "expires_at": "2025-01-24T10:30:00Z"
      }
    ],
    "processing": {
      "started_at": "2025-01-17T10:32:00Z",
      "estimated_completion": "2025-01-17T10:50:00Z",
      "worker_id": "worker-video-7f9d8c-abc"
    },
    "cost": {
      "estimated_usd": 0.15,
      "actual_usd": null
    },
    "created_at": "2025-01-17T10:30:00Z",
    "updated_at": "2025-01-17T10:40:00Z"
  }
}
```

**Status Values:**
- `pending`: Job created, not yet queued
- `queued`: Job in queue, waiting for worker
- `processing`: Worker actively processing
- `completed`: Processing completed successfully
- `failed`: Processing failed
- `cancelled`: Job cancelled by user

---

#### List User Jobs

```http
GET /jobs?status=completed&limit=20&offset=0&sort=created_at:desc
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| status | string | all | Filter by status |
| job_type | string | all | Filter by type (video, image, audio) |
| limit | integer | 20 | Results per page (max 100) |
| offset | integer | 0 | Pagination offset |
| sort | string | created_at:desc | Sort field and order |
| from_date | string | - | Filter from date (ISO 8601) |
| to_date | string | - | Filter to date (ISO 8601) |

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "job_id": "job_abc123",
        "status": "completed",
        "job_type": "video",
        "input_filename": "video.mp4",
        "created_at": "2025-01-17T10:30:00Z",
        "completed_at": "2025-01-17T10:45:00Z",
        "processing_duration_seconds": 900
      },
      ...
    ],
    "pagination": {
      "total": 150,
      "limit": 20,
      "offset": 0,
      "has_more": true
    }
  }
}
```

---

#### Cancel Job

```http
POST /jobs/{job_id}/cancel
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "job_id": "job_abc123",
    "status": "cancelled",
    "cancelled_at": "2025-01-17T10:35:00Z"
  }
}
```

**Note:** Jobs can only be cancelled if status is `pending` or `queued`.

---

#### Delete Job

```http
DELETE /jobs/{job_id}
```

Deletes job metadata and associated files from storage.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "job_id": "job_abc123",
    "deleted": true,
    "files_deleted": [
      "s3://media-uploads/.../original.mp4",
      "s3://media-processed/.../1080p.mp4"
    ]
  }
}
```

---

#### Retry Failed Job

```http
POST /jobs/{job_id}/retry
```

**Response:** `202 Accepted`

```json
{
  "success": true,
  "data": {
    "job_id": "job_abc123",
    "status": "pending",
    "retry_count": 1,
    "max_retries": 3
  }
}
```

---

### Processing Presets

#### List Presets

```http
GET /presets?job_type=video
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "presets": [
      {
        "id": "preset_youtube",
        "name": "YouTube Standard",
        "description": "Optimized for YouTube uploads",
        "job_type": "video",
        "config": {
          "outputs": [
            {"resolution": "1080p", "bitrate": "8000k", "format": "mp4"},
            {"resolution": "720p", "bitrate": "5000k", "format": "mp4"}
          ],
          "thumbnail": true
        },
        "usage_count": 1520
      },
      ...
    ]
  }
}
```

---

#### Get Preset Details

```http
GET /presets/{preset_id}
```

---

#### Create Custom Preset

```http
POST /presets
```

**Request Body:**

```json
{
  "name": "My Custom Preset",
  "description": "Custom encoding settings",
  "job_type": "video",
  "config": {
    "outputs": [
      {"resolution": "1080p", "bitrate": "10000k", "format": "mp4"}
    ]
  },
  "is_public": false
}
```

**Response:** `201 Created`

---

### Webhooks

#### Create Webhook

```http
POST /webhooks
```

**Request Body:**

```json
{
  "url": "https://example.com/webhook",
  "secret": "webhook_secret_key",
  "events": ["job.completed", "job.failed"]
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "webhook_id": "webhook_abc123",
    "url": "https://example.com/webhook",
    "events": ["job.completed", "job.failed"],
    "is_active": true,
    "created_at": "2025-01-17T10:30:00Z"
  }
}
```

---

#### List Webhooks

```http
GET /webhooks
```

---

#### Delete Webhook

```http
DELETE /webhooks/{webhook_id}
```

---

#### Test Webhook

```http
POST /webhooks/{webhook_id}/test
```

Sends a test payload to verify webhook is working.

---

### Webhook Payload Format

When a webhook event is triggered, we send a POST request to your URL:

```http
POST {your_webhook_url}
Content-Type: application/json
X-Webhook-Signature: sha256=abc123...
X-Webhook-Event: job.completed
```

**Payload:**

```json
{
  "event": "job.completed",
  "timestamp": "2025-01-17T10:45:00Z",
  "data": {
    "job_id": "job_abc123",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "outputs": [
      {
        "type": "video",
        "resolution": "1080p",
        "url": "https://cdn.media-encoder.com/output/..."
      }
    ]
  }
}
```

**Signature Verification:**

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

---

### User Account

#### Get Current User

```http
GET /me
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "johndoe",
    "tier": "free",
    "quotas": {
      "storage_quota_gb": 5,
      "storage_used_gb": 2.3,
      "storage_used_percentage": 46,
      "monthly_processing_minutes": 60,
      "monthly_processing_used": 25,
      "monthly_processing_remaining": 35
    },
    "rate_limit": {
      "requests_per_minute": 10,
      "current_usage": 3
    },
    "created_at": "2025-01-01T00:00:00Z",
    "last_login_at": "2025-01-17T09:00:00Z"
  }
}
```

---

#### Update User Profile

```http
PATCH /me
```

**Request Body:**

```json
{
  "username": "newusername",
  "email": "newemail@example.com"
}
```

---

#### Get Usage Statistics

```http
GET /me/stats?period=30d
```

**Query Parameters:**
- `period`: 7d, 30d, 90d, all

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "period": "30d",
    "jobs": {
      "total": 150,
      "completed": 142,
      "failed": 8,
      "success_rate": 94.67
    },
    "processing": {
      "total_minutes": 450,
      "avg_time_per_job_seconds": 180
    },
    "storage": {
      "total_uploaded_gb": 15.2,
      "total_processed_gb": 12.8
    },
    "costs": {
      "total_usd": 12.50,
      "avg_per_job_usd": 0.083
    }
  }
}
```

---

### Admin Endpoints (Enterprise)

#### Get System Metrics

```http
GET /admin/metrics
Authorization: Bearer <admin_api_key>
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "queue": {
      "pending_jobs": 450,
      "queues": {
        "video_high": 20,
        "video_normal": 300,
        "image_normal": 100,
        "audio_normal": 30
      }
    },
    "workers": {
      "total": 25,
      "active": 23,
      "idle": 2,
      "by_type": {
        "video": 15,
        "image": 7,
        "audio": 3
      }
    },
    "performance": {
      "avg_processing_time_seconds": 145,
      "p95_processing_time_seconds": 320,
      "p99_processing_time_seconds": 480
    }
  }
}
```

---

## Rate Limiting

Rate limits are enforced per API key:

| Tier | Requests/minute | Requests/hour | Requests/day |
|------|----------------|---------------|--------------|
| Free | 10 | 500 | 5,000 |
| Pro | 100 | 5,000 | 50,000 |
| Enterprise | Custom | Custom | Custom |

**Rate Limit Headers:**

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1642420800
```

**Rate Limit Exceeded Response:**

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 45 seconds.",
    "details": {
      "limit": 10,
      "reset_at": "2025-01-17T10:31:00Z"
    }
  }
}
```

---

## Pagination

List endpoints support cursor-based pagination:

**Request:**

```http
GET /jobs?limit=20&offset=0
```

**Response:**

```json
{
  "data": [...],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "has_more": true,
    "next_offset": 20
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| INVALID_REQUEST | 400 | Malformed request |
| UNAUTHORIZED | 401 | Missing or invalid auth |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| INVALID_FILE_FORMAT | 422 | Unsupported file format |
| FILE_TOO_LARGE | 422 | File exceeds size limit |
| QUOTA_EXCEEDED | 422 | User quota exceeded |
| RATE_LIMIT_EXCEEDED | 429 | Rate limit exceeded |
| INTERNAL_ERROR | 500 | Internal server error |
| SERVICE_UNAVAILABLE | 503 | Service temporarily down |

---

## SDKs and Code Examples

### cURL

```bash
# Upload and create job
curl -X POST https://api.media-encoder.com/v1/jobs \
  -H "Authorization: Bearer sk_live_abc123" \
  -F "file=@video.mp4" \
  -F "job_type=video" \
  -F "preset=youtube_standard"

# Get job status
curl https://api.media-encoder.com/v1/jobs/job_abc123 \
  -H "Authorization: Bearer sk_live_abc123"
```

### JavaScript (Node.js)

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const apiKey = 'sk_live_abc123';
const baseURL = 'https://api.media-encoder.com/v1';

// Upload file
const form = new FormData();
form.append('file', fs.createReadStream('video.mp4'));
form.append('job_type', 'video');
form.append('preset', 'youtube_standard');

const response = await axios.post(`${baseURL}/jobs`, form, {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    ...form.getHeaders()
  }
});

console.log('Job ID:', response.data.data.job_id);

// Poll for status
const checkStatus = async (jobId) => {
  const res = await axios.get(`${baseURL}/jobs/${jobId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  return res.data.data;
};
```

### Python

```python
import requests

api_key = 'sk_live_abc123'
base_url = 'https://api.media-encoder.com/v1'
headers = {'Authorization': f'Bearer {api_key}'}

# Upload file
with open('video.mp4', 'rb') as f:
    files = {'file': f}
    data = {
        'job_type': 'video',
        'preset': 'youtube_standard'
    }
    response = requests.post(
        f'{base_url}/jobs',
        headers=headers,
        files=files,
        data=data
    )

job_id = response.json()['data']['job_id']

# Check status
status_response = requests.get(
    f'{base_url}/jobs/{job_id}',
    headers=headers
)
print(status_response.json())
```

---

## API Versioning

The API uses URL-based versioning:

- Current version: `v1`
- Base URL: `https://api.media-encoder.com/v1`

Breaking changes will result in a new version (v2, v3, etc.). Old versions will be supported for at least 12 months after a new version is released.

---

## Best Practices

1. **Store API Keys Securely**: Never commit API keys to version control
2. **Use Webhooks**: Poll status sparingly, prefer webhooks for notifications
3. **Handle Rate Limits**: Implement exponential backoff
4. **Validate Before Upload**: Check file format client-side to avoid wasted uploads
5. **Use Presets**: Leverage presets for common use cases
6. **Monitor Quotas**: Check quota usage regularly to avoid surprises
7. **Set Timeouts**: Implement reasonable timeouts for API requests (30s recommended)
