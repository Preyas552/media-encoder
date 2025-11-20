# Deployment & Infrastructure Specification

## Overview

This document covers deployment strategies, Kubernetes configurations, Docker setups, and infrastructure as code for the media encoder system.

---

## Docker Configuration

### API Service Dockerfile

```dockerfile
# docker/api/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application (if using TypeScript)
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node healthcheck.js || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/server.js"]
```

### Worker Dockerfile

```dockerfile
# docker/worker/Dockerfile
FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install FFmpeg and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy worker code
COPY worker/ .

# Create non-root user
RUN useradd -m -u 1001 worker && \
    chown -R worker:worker /app

# Create processing directory
RUN mkdir -p /tmp/processing && \
    chown worker:worker /tmp/processing

USER worker

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python3 healthcheck.py || exit 1

# Start worker
CMD ["python3", "worker.py"]
```

### Docker Compose (Local Development)

```yaml
# docker-compose.yml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: media_encoder
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Queue
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # MinIO (S3-compatible storage)
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  # API Service
  api:
    build:
      context: .
      dockerfile: docker/api/Dockerfile
    environment:
      NODE_ENV: development
      PORT: 8080
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/media_encoder
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
      S3_BUCKET_UPLOADS: media-uploads
      S3_BUCKET_PROCESSED: media-processed
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    restart: unless-stopped

  # Video Worker
  worker-video:
    build:
      context: .
      dockerfile: docker/worker/Dockerfile
    environment:
      WORKER_TYPE: video
      QUEUE_NAMES: jobs.video.high,jobs.video.normal,jobs.video.low
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/media_encoder
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
    depends_on:
      - postgres
      - redis
      - minio
    restart: unless-stopped
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '4'
          memory: 8G

  # Image Worker
  worker-image:
    build:
      context: .
      dockerfile: docker/worker/Dockerfile
    environment:
      WORKER_TYPE: image
      QUEUE_NAMES: jobs.image.high,jobs.image.normal
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/media_encoder
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
    depends_on:
      - postgres
      - redis
      - minio
    restart: unless-stopped
    deploy:
      replicas: 1

volumes:
  postgres-data:
  redis-data:
  minio-data:
```

---

## Kubernetes Deployment

### Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: media-encoder
```

### ConfigMap

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: media-encoder-config
  namespace: media-encoder
data:
  # Application configuration
  NODE_ENV: "production"
  LOG_LEVEL: "info"

  # S3 configuration
  S3_BUCKET_UPLOADS: "media-uploads"
  S3_BUCKET_PROCESSED: "media-processed"
  S3_REGION: "us-east-1"

  # Queue configuration
  QUEUE_VIDEO_HIGH: "jobs.video.high"
  QUEUE_VIDEO_NORMAL: "jobs.video.normal"
  QUEUE_IMAGE_NORMAL: "jobs.image.normal"
  QUEUE_AUDIO_NORMAL: "jobs.audio.normal"

  # Worker configuration
  MAX_RETRIES: "3"
  PROCESSING_TIMEOUT: "3600"
```

### Secrets

```yaml
# k8s/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: media-encoder-secrets
  namespace: media-encoder
type: Opaque
stringData:
  # Database credentials
  DATABASE_URL: "postgresql://user:password@postgres.media-encoder.svc.cluster.local:5432/media_encoder"

  # Redis URL
  REDIS_URL: "redis://redis.media-encoder.svc.cluster.local:6379"

  # S3 credentials
  S3_ACCESS_KEY: "your-access-key"
  S3_SECRET_KEY: "your-secret-key"

  # API keys (for admin)
  ADMIN_API_KEY: "sk_admin_xyz123"
```

### API Deployment

```yaml
# k8s/deployments/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: media-encoder
  labels:
    app: media-encoder
    component: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: media-encoder
      component: api
  template:
    metadata:
      labels:
        app: media-encoder
        component: api
    spec:
      containers:
      - name: api
        image: your-registry/media-encoder-api:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 8080
          name: http
        envFrom:
        - configMapRef:
            name: media-encoder-config
        - secretRef:
            name: media-encoder-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
      terminationGracePeriodSeconds: 30
```

### API Service

```yaml
# k8s/services/api-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: media-encoder
  labels:
    app: media-encoder
    component: api
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
    name: http
  selector:
    app: media-encoder
    component: api
```

### Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: media-encoder-ingress
  namespace: media-encoder
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-body-size: "5000m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.media-encoder.com
    secretName: media-encoder-tls
  rules:
  - host: api.media-encoder.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              number: 80
```

### Worker Deployment (Video)

```yaml
# k8s/deployments/worker-video-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-video
  namespace: media-encoder
  labels:
    app: media-encoder
    component: worker
    worker-type: video
spec:
  replicas: 5
  selector:
    matchLabels:
      app: media-encoder
      component: worker
      worker-type: video
  template:
    metadata:
      labels:
        app: media-encoder
        component: worker
        worker-type: video
    spec:
      containers:
      - name: worker
        image: your-registry/media-encoder-worker:latest
        imagePullPolicy: Always
        env:
        - name: WORKER_TYPE
          value: "video"
        - name: QUEUE_NAMES
          value: "jobs.video.high,jobs.video.normal,jobs.video.low"
        envFrom:
        - configMapRef:
            name: media-encoder-config
        - secretRef:
            name: media-encoder-secrets
        resources:
          requests:
            memory: "4Gi"
            cpu: "2000m"
          limits:
            memory: "8Gi"
            cpu: "4000m"
        volumeMounts:
        - name: processing-tmpfs
          mountPath: /tmp/processing
        livenessProbe:
          exec:
            command:
            - python3
            - healthcheck.py
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
      volumes:
      - name: processing-tmpfs
        emptyDir:
          medium: Memory
          sizeLimit: 4Gi
      terminationGracePeriodSeconds: 300  # 5 minutes for job completion
```

### Horizontal Pod Autoscaler (HPA)

```yaml
# k8s/hpa/api-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: media-encoder
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

### KEDA ScaledObject (Queue-based autoscaling)

```yaml
# k8s/keda/worker-video-scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-video-scaledobject
  namespace: media-encoder
spec:
  scaleTargetRef:
    name: worker-video
  minReplicaCount: 1
  maxReplicaCount: 50
  pollingInterval: 10
  cooldownPeriod: 300
  triggers:
  - type: redis
    metadata:
      address: redis.media-encoder.svc.cluster.local:6379
      listName: jobs.video.normal
      listLength: "5"  # Scale up when queue has >5 messages per pod
  - type: redis
    metadata:
      address: redis.media-encoder.svc.cluster.local:6379
      listName: jobs.video.high
      listLength: "1"  # Aggressive scaling for high priority
```

---

## Monitoring Stack

### Prometheus

```yaml
# k8s/monitoring/prometheus-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: media-encoder
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s

    scrape_configs:
      # API metrics
      - job_name: 'api'
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names:
                - media-encoder
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_component]
            action: keep
            regex: api

      # Worker metrics
      - job_name: 'workers'
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names:
                - media-encoder
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_component]
            action: keep
            regex: worker

    alerting:
      alertmanagers:
        - static_configs:
            - targets:
                - alertmanager:9093
```

### Grafana Dashboard

```yaml
# k8s/monitoring/grafana-dashboard.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-media-encoder
  namespace: media-encoder
  labels:
    grafana_dashboard: "1"
data:
  media-encoder.json: |
    {
      "dashboard": {
        "title": "Media Encoder Metrics",
        "panels": [
          {
            "title": "Queue Depth",
            "targets": [
              {
                "expr": "queue_depth{job='workers'}"
              }
            ]
          },
          {
            "title": "Job Processing Time (p95)",
            "targets": [
              {
                "expr": "histogram_quantile(0.95, processing_duration_seconds_bucket)"
              }
            ]
          },
          {
            "title": "Active Workers",
            "targets": [
              {
                "expr": "count(up{job='workers'} == 1) by (worker_type)"
              }
            ]
          }
        ]
      }
    }
```

---

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches:
      - main
      - develop

env:
  REGISTRY: ghcr.io
  IMAGE_API: ghcr.io/${{ github.repository }}/api
  IMAGE_WORKER: ghcr.io/${{ github.repository }}/worker

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Log in to Container Registry
        uses: docker/login-action@v2
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push API image
        uses: docker/build-push-action@v4
        with:
          context: .
          file: docker/api/Dockerfile
          push: true
          tags: |
            ${{ env.IMAGE_API }}:${{ github.sha }}
            ${{ env.IMAGE_API }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push Worker image
        uses: docker/build-push-action@v4
        with:
          context: .
          file: docker/worker/Dockerfile
          push: true
          tags: |
            ${{ env.IMAGE_WORKER }}:${{ github.sha }}
            ${{ env.IMAGE_WORKER }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Configure kubectl
        uses: azure/k8s-set-context@v3
        with:
          method: kubeconfig
          kubeconfig: ${{ secrets.KUBE_CONFIG }}

      - name: Update deployment images
        run: |
          kubectl set image deployment/api \
            api=${{ env.IMAGE_API }}:${{ github.sha }} \
            -n media-encoder

          kubectl set image deployment/worker-video \
            worker=${{ env.IMAGE_WORKER }}:${{ github.sha }} \
            -n media-encoder

      - name: Wait for rollout
        run: |
          kubectl rollout status deployment/api -n media-encoder
          kubectl rollout status deployment/worker-video -n media-encoder
```

---

## Infrastructure as Code (Terraform)

### AWS Infrastructure

```hcl
# terraform/main.tf
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# S3 Buckets
resource "aws_s3_bucket" "uploads" {
  bucket = "media-encoder-uploads-${var.environment}"

  tags = {
    Name        = "Media Uploads"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "processed" {
  bucket = "media-encoder-processed-${var.environment}"

  tags = {
    Name        = "Media Processed"
    Environment = var.environment
  }
}

# Lifecycle policies
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "delete-old-uploads"
    status = "Enabled"

    expiration {
      days = 30
    }
  }
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier           = "media-encoder-db-${var.environment}"
  engine              = "postgres"
  engine_version      = "15.4"
  instance_class      = "db.t3.medium"
  allocated_storage   = 100
  storage_encrypted   = true

  db_name  = "media_encoder"
  username = var.db_username
  password = var.db_password

  multi_az               = true
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"

  vpc_security_group_ids = [aws_security_group.postgres.id]
  db_subnet_group_name   = aws_db_subnet_group.postgres.name

  tags = {
    Name        = "Media Encoder DB"
    Environment = var.environment
  }
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "media-encoder-redis-${var.environment}"
  engine               = "redis"
  node_type            = "cache.t3.medium"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379

  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = {
    Name        = "Media Encoder Redis"
    Environment = var.environment
  }
}

# EKS Cluster (simplified)
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"

  cluster_name    = "media-encoder-${var.environment}"
  cluster_version = "1.28"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    api = {
      min_size     = 2
      max_size     = 10
      desired_size = 3

      instance_types = ["t3.large"]
      capacity_type  = "ON_DEMAND"

      labels = {
        workload = "api"
      }
    }

    workers = {
      min_size     = 1
      max_size     = 50
      desired_size = 5

      instance_types = ["c5.2xlarge"]
      capacity_type  = "SPOT"

      labels = {
        workload = "worker"
      }

      taints = [{
        key    = "workload"
        value  = "worker"
        effect = "NO_SCHEDULE"
      }]
    }
  }

  tags = {
    Environment = var.environment
  }
}
```

---

## Cost Optimization

### Spot Instances for Workers

```yaml
# k8s/deployments/worker-video-spot.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-video-spot
  namespace: media-encoder
spec:
  # ... other config ...
  template:
    spec:
      nodeSelector:
        kubernetes.io/lifecycle: spot
      tolerations:
      - key: "spot"
        operator: "Equal"
        value: "true"
        effect: "NoSchedule"
```

### S3 Intelligent Tiering

```hcl
resource "aws_s3_bucket_intelligent_tiering_configuration" "processed" {
  bucket = aws_s3_bucket.processed.id
  name   = "intelligent-tiering"

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }
}
```

---

## Deployment Checklist

### Pre-deployment
- [ ] Database migrations tested
- [ ] Secrets configured in Kubernetes
- [ ] S3 buckets created and accessible
- [ ] Redis/queue accessible from cluster
- [ ] Container images built and pushed
- [ ] DNS configured
- [ ] TLS certificates provisioned

### Deployment
- [ ] Apply namespace
- [ ] Apply secrets and configmaps
- [ ] Deploy database (if self-hosted)
- [ ] Deploy Redis (if self-hosted)
- [ ] Deploy API service
- [ ] Deploy workers
- [ ] Configure autoscaling (HPA/KEDA)
- [ ] Set up monitoring
- [ ] Configure ingress

### Post-deployment
- [ ] Verify API health endpoints
- [ ] Test file upload
- [ ] Verify worker processing
- [ ] Check queue connectivity
- [ ] Monitor metrics dashboard
- [ ] Test autoscaling
- [ ] Verify webhooks (if configured)
- [ ] Load testing
