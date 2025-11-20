#!/bin/bash

echo "🚀 Initializing LocalStack..."

# Create S3 buckets
awslocal s3 mb s3://media-uploads
awslocal s3 mb s3://media-processed
awslocal s3 mb s3://media-temp

echo "✅ LocalStack ready!"
echo "📦 Created buckets: media-uploads, media-processed, media-temp"
