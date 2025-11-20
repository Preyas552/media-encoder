import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

export const s3Client = new S3Client({
    endpoint: process.env.AWS_ENDPOINT,
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

export const BUCKET_UPLOADS = process.env.S3_BUCKET_UPLOADS || 'media-uploads';
export const BUCKET_PROCESSED = process.env.S3_BUCKET_PROCESSED || 'media-processed';
