import React, { useState } from 'react'
import api from './api/client'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<any>(null)
  const [jobId, setJobId] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [outputFormat, setOutputFormat] = useState('mp4')

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files ? e.target.files[0] : null
    setError(null)
    if (selectedFile && selectedFile.size > 500 * 1024 * 1024) {
      setError('File is too large (max 500MB)')
      return
    }
    setFile(selectedFile)
  }

  const upload = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setUploadProgress(0)
    if (!file) return setError('Please select a file')

    try {
      setLoading(true)
      const fd = new FormData()
      fd.append('file', file)
      fd.append('output_format', outputFormat)

      const res = await api.post('/jobs', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent: any) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded / progressEvent.total) * 100)
            : 0
          setUploadProgress(progress)
        }
      })
      setJob(res.data.job)
      setJobId(res.data.job.id)
      setFile(null)
      setUploadProgress(100)
    } catch (err: any) {
      const errMsg = err?.response?.data?.error || err.message || 'Upload failed'
      setError(`Upload failed: ${errMsg}`)
    } finally {
      setLoading(false)
    }
  }

  const checkStatus = async () => {
    setError(null)
    if (!jobId.trim()) return setError('Enter a job ID to check')
    try {
      setCheckingStatus(true)
      const res = await api.get(`/jobs/${jobId}`)
      setStatus(res.data.job.status)
      setJob(res.data.job)
    } catch (err: any) {
      const errMsg = err?.response?.data?.error || err.message || 'Failed to fetch status'
      setError(`Status check failed: ${errMsg}`)
    } finally {
      setCheckingStatus(false)
    }
  }

  return (
    <div className="container">
      <h1>Media Encoder</h1>
      <section className="card">
        <h2>Upload Media File</h2>
        <form onSubmit={upload}>
          <div className="form-group">
            <label htmlFor="file-input">Select a file (max 500MB):</label>
            <input
              id="file-input"
              type="file"
              onChange={onFileChange}
              disabled={loading}
              accept="video/*,audio/*,image/*"
            />
            {file && <p className="info">Selected: {file.name} ({Math.round(file.size / 1024 / 1024)} MB)</p>}
          </div>

          <div className="form-group">
            <label htmlFor="format-select">Output Format:</label>
            <select
              id="format-select"
              value={outputFormat}
              onChange={e => setOutputFormat(e.target.value)}
              disabled={loading}
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="avi">AVI</option>
              <option value="webm">WEBM</option>
              <option value="mov">MOV</option>
              <option value="mkv">MKV</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
            </select>
          </div>
          <button type="submit" disabled={loading || !file}>{loading ? 'Uploading...' : 'Upload'}</button>
        </form>

        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
            <span className="progress-text">{uploadProgress}%</span>
          </div>
        )}

        {error && <div className="error">❌ {error}</div>}
        {job && (
          <div className="meta">
            <p>✅ Job created successfully!</p>
            <p><strong>Job ID:</strong> <code>{job.id}</code></p>
            <p><strong>Status:</strong> {job.status}</p>
            <p><strong>Created:</strong> {new Date(job.created_at).toLocaleString()}</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Check Job Status</h2>
        <div className="form-group">
          <label htmlFor="job-id-input">Job ID:</label>
          <div className="row">
            <input
              id="job-id-input"
              value={jobId}
              onChange={e => setJobId(e.target.value)}
              placeholder="Paste job ID here"
              disabled={checkingStatus}
            />
            <button onClick={checkStatus} disabled={checkingStatus || !jobId.trim()}>
              {checkingStatus ? 'Checking...' : 'Check'}
            </button>
          </div>
        </div>

        {status && <p className="info">Current status: <strong>{status}</strong></p>}
        {job && (
          <div className="job-details">
            <h3>Job Details</h3>
            <pre className="job-json">{JSON.stringify(job, null, 2)}</pre>

            {job.downloadUrl && (
              <div className="actions" style={{ marginTop: '1rem' }}>
                <a
                  href={job.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button download-btn"
                  style={{
                    display: 'inline-block',
                    padding: '10px 20px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '4px',
                    fontWeight: 'bold'
                  }}
                >
                  ⬇️ Download Processed File
                </a>
              </div>
            )}
          </div>
        )}
      </section>

      <footer>
        <small>🔗 Backend API: {import.meta.env.VITE_API_URL || 'http://localhost:8080'}</small>
      </footer>
    </div>
  )
}
