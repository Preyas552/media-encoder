import os
import time
import json
import redis
import boto3
import psycopg2
from processor import transcode_video
from dotenv import load_dotenv

load_dotenv()

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/media_encoder')
AWS_ENDPOINT = os.getenv('AWS_ENDPOINT', 'http://localhost:4566')
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID', 'test')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY', 'test')
S3_BUCKET_UPLOADS = os.getenv('S3_BUCKET_UPLOADS', 'media-uploads')
S3_BUCKET_PROCESSED = os.getenv('S3_BUCKET_PROCESSED', 'media-processed')

# Initialize clients
r = redis.from_url(REDIS_URL)
s3 = boto3.client('s3',
    endpoint_url=AWS_ENDPOINT,
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY
)
conn = psycopg2.connect(DATABASE_URL)

def update_job_status(job_id, status):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = %s, updated_at = NOW() WHERE id = %s",
            (status, job_id)
        )
        conn.commit()
    print(f"Job {job_id} status updated to {status}")

def process_job(job_id):
    print(f"Processing job {job_id}")
    
    try:
        # Get job details
        with conn.cursor() as cur:
            cur.execute("SELECT input_filename, output_format FROM jobs WHERE id = %s", (job_id,))
            result = cur.fetchone()
            if not result:
                print(f"Job {job_id} not found in DB")
                return
            input_filename = result[0]
            output_format = result[1]

        update_job_status(job_id, 'processing')

        # Download from S3
        local_input = f"/tmp/{input_filename}"
        # Ensure output filename has correct extension
        filename_base = os.path.splitext(input_filename)[0]
        local_output = f"/tmp/processed_{filename_base}.{output_format}"
        
        print(f"Downloading {input_filename} from S3...")
        s3.download_file(S3_BUCKET_UPLOADS, input_filename, local_input)

        # Transcode
        if transcode_video(local_input, local_output, output_format):
            # Upload to S3
            print(f"Uploading {local_output} to S3...")
            s3.upload_file(local_output, S3_BUCKET_PROCESSED, f"processed_{filename_base}.{output_format}")
            
            update_job_status(job_id, 'completed')
        else:
            update_job_status(job_id, 'failed')

        # Cleanup
        if os.path.exists(local_input):
            os.remove(local_input)
        if os.path.exists(local_output):
            os.remove(local_output)

    except Exception as e:
        print(f"Error processing job {job_id}: {e}")
        update_job_status(job_id, 'failed')

def main():
    print("Worker started. Waiting for jobs...")
    
    while True:
        try:
            # Blocking pop from Redis queue
            # blpop returns a tuple (queue_name, value)
            _, job_id_bytes = r.blpop('jobs_queue')
            job_id = job_id_bytes.decode('utf-8')
            
            process_job(job_id)
        except Exception as e:
            print(f"Error polling Redis: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
