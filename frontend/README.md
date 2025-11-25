# Frontend (Vite + React)

This is a feature-rich frontend for the Media Encoder project.

## Features

- 📤 **File Upload** — Upload media files with progress bar and validation (max 500MB)
- 📊 **Job Status Checker** — Query job status by ID
- 🎨 **Modern UI** — Clean, responsive design with better error messages
- ✅ **Smoke Tests** — E2E test for upload and job verification

## Quick Start (Windows cmd.exe)

### Development

From the project root:

```cmd
cd frontend
npm install
npm run dev
```

- Dev server runs at **http://localhost:5173**
- Vite proxy automatically routes `/api` requests to `http://localhost:8080`
- HMR (hot module reload) enabled for fast development

Or use convenience scripts from project root:

```cmd
npm run frontend:install
npm run frontend:dev
```

### Build for Production

```cmd
cd frontend
npm run build
```

Creates optimized static assets in `frontend/dist/`. These are automatically served by the backend when you run `npm run build && npm start`.

## Testing

### Smoke Test

Uploads a test file and verifies job creation:

```cmd
cd frontend
npm install
npm run test:smoke
```

You can also specify the API URL:

```cmd
API_URL=http://localhost:8080 npm run test:smoke
```

The test:
1. ✓ Checks API health (`GET /health`)
2. ✓ Creates a 500KB dummy video file
3. ✓ Uploads to `/api/jobs` with FormData
4. ✓ Verifies job was created and has an ID
5. ✓ Cleans up test file

## Architecture

- **Framework**: React 18 + Vite 5 (TypeScript)
- **HTTP Client**: Axios with upload progress support
- **Styling**: CSS-in-JS (minimal, inline styles)
- **Backend Proxy**: Vite dev server proxies `/api` to backend

## Environment Variables

Create a `.env` file in `frontend/` if needed:

```
VITE_API_URL=http://localhost:8080
```

Then in code: `import.meta.env.VITE_API_URL`

## Component Structure

- `src/main.tsx` — React entry point
- `src/App.tsx` — Main component (upload + status checker)
- `src/api/client.ts` — Axios client configured for `/api` base URL
- `src/styles.css` — All styling
- `index.html` — HTML template (Vite entry point)

## API Endpoints Used

- `GET /health` — Health check
- `POST /api/jobs` — Create encoding job (multipart/form-data)
- `GET /api/jobs/:id` — Get job status

Requires backend running on port 8080.

## Next Steps

- [ ] Add authentication (JWT / API keys)
- [ ] Real-time job status updates (WebSocket / polling)
- [ ] Download output files from S3
- [ ] Job history / list view
- [ ] Theme customization
- [ ] Unit tests (Jest / Vitest)


