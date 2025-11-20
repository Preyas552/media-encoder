import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_UPLOADS } from './s3';
import { query } from './db';
import fs from 'fs';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/jobs', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { originalname, path, size } = req.file;
        const fileContent = fs.readFileSync(path);

        // Upload to S3
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_UPLOADS,
            Key: originalname,
            Body: fileContent,
        }));

        // Create DB record
        let userId;
        try {
            const userRes = await query('SELECT id FROM users LIMIT 1');
            if (userRes.rows.length > 0) {
                userId = userRes.rows[0].id;
            } else {
                const newUser = await query(
                    `INSERT INTO users (email, username, api_key) 
            VALUES ($1, $2, $3) 
            RETURNING id`,
                    ['test@example.com', 'testuser', 'testkey']
                );
                userId = newUser.rows[0].id;
            }
        } catch (dbError: any) {
            // If table doesn't exist or connection fails, we might want to handle it.
            // But for now, let it throw to the catch block.
            throw dbError;
        }

        const jobRes = await query(
            `INSERT INTO jobs (user_id, job_type, status, input_filename, input_size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
            [userId, 'transcode', 'pending', originalname, size]
        );

        // Cleanup local file
        fs.unlinkSync(path);

        // Push to Redis queue
        await redisClient.lPush('jobs_queue', jobRes.rows[0].id);

        res.json({ job: jobRes.rows[0] });

    } catch (error: any) {
        console.error(error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

router.get('/jobs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT * FROM jobs WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json({ job: result.rows[0] });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
