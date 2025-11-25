import express from 'express';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

import routes from './routes';

app.use(express.json());

// Serve static frontend files from dist/
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendPath));

app.use('/api', routes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// SPA fallback: serve index.html for all non-API routes
app.use((req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
