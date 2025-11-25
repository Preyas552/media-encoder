# Media Encoder

A full-stack media encoding application that allows users to upload videos, transcode them to different formats, and download the processed files.

## Features

- **Frontend**: React application for file upload and status monitoring.
- **Backend**: Node.js/Express API for handling uploads and job management.
- **Worker**: Python worker for processing video transcoding jobs using FFmpeg.
- **Infrastructure**: Dockerized setup with LocalStack (S3, SQS), PostgreSQL, and Redis.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

## Running with Docker (Recommended)

This is the easiest way to run the entire application stack.

### Linux / macOS

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Preyas552/media-encoder.git
    cd media-encoder
    ```

2.  **Start the application:**
    ```bash
    docker-compose up --build
    ```

3.  **Access the application:**
    - Frontend: [http://localhost](http://localhost)
    - Backend API: [http://localhost:8080](http://localhost:8080)
    - LocalStack S3: [http://localhost:4566](http://localhost:4566)

### Windows (PowerShell)

1.  **Clone the repository:**
    ```powershell
    git clone https://github.com/Preyas552/media-encoder.git
    cd media-encoder
    ```

2.  **Start the application:**
    ```powershell
    docker-compose up --build
    ```

3.  **Access the application:**
    - Frontend: [http://localhost](http://localhost)
    - Backend API: [http://localhost:8080](http://localhost:8080)
    - LocalStack S3: [http://localhost:4566](http://localhost:4566)

## Manual Setup (Development)

If you want to run services individually for development:

1.  **Start Infrastructure:**
    ```bash
    docker-compose up -d postgres redis localstack
    ```

2.  **Backend:**
    ```bash
    npm install
    npm run dev
    ```

3.  **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4.  **Worker:**
    ```bash
    cd worker
    pip install -r requirements.txt
    python main.py
    ```
