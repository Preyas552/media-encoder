/**
 * Smoke Test: Upload a file and verify job creation
 * Run: npm run test:smoke (from frontend/ directory)
 * or: npx ts-node tests/smoke.test.ts
 */
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const API_URL = process.env.API_URL || 'http://localhost:8080'

async function smokeTest() {
  console.log('🧪 Starting smoke test...')
  console.log(`📡 API URL: ${API_URL}`)

  try {
    // Step 1: Check API health
    console.log('\n✓ Step 1: Checking API health...')
    const healthRes = await axios.get(`${API_URL}/health`, { timeout: 5000 })
    if (healthRes.data.status !== 'ok') {
      throw new Error('Health check failed')
    }
    console.log('  ✓ API is healthy')

    // Step 2: Create a small test file (500KB dummy video file)
    console.log('\n✓ Step 2: Creating test file...')
    const testFileName = 'smoke-test-video.mp4'
    const testFilePath = path.join(__dirname, testFileName)
    const dummyData = Buffer.alloc(500 * 1024, 'test-content')
    fs.writeFileSync(testFilePath, dummyData)
    console.log(`  ✓ Created test file: ${testFileName} (${dummyData.length} bytes)`)

    // Step 3: Upload the file
    console.log('\n✓ Step 3: Uploading file...')
    // Use the `form-data` package in Node so we can obtain correct multipart headers
    const FormData = require('form-data') as any
    const uploadFormData = new FormData()
    const fileStream = fs.createReadStream(testFilePath)
    uploadFormData.append('file', fileStream)

    const headers = uploadFormData.getHeaders()

    const uploadRes = await axios.post(`${API_URL}/api/jobs`, uploadFormData, {
      headers: {
        ...headers
      },
      timeout: 30000
    })

    const jobId = uploadRes.data.job?.id
    const jobStatus = uploadRes.data.job?.status

    if (!jobId) {
      throw new Error('No job ID in response: ' + JSON.stringify(uploadRes.data))
    }

    console.log(`  ✓ File uploaded successfully`)
    console.log(`  ✓ Job ID: ${jobId}`)
    console.log(`  ✓ Initial status: ${jobStatus}`)

    // Step 4: Verify job exists and fetch status
    console.log('\n✓ Step 4: Verifying job creation...')
    const statusRes = await axios.get(`${API_URL}/api/jobs/${jobId}`, { timeout: 5000 })
    const job = statusRes.data.job

    if (!job || !job.id) {
      throw new Error('Failed to fetch job after creation')
    }

    console.log(`  ✓ Job verified`)
    console.log(`  ✓ Current status: ${job.status}`)
    console.log(`  ✓ Input filename: ${job.input_filename}`)
    console.log(`  ✓ Input size: ${job.input_size_bytes} bytes`)

    // Clean up
    fs.unlinkSync(testFilePath)
    console.log(`\n✓ Test file cleaned up`)

    console.log('\n✅ Smoke test passed!\n')
    return { success: true, jobId }
  } catch (error: any) {
    console.error('\n❌ Smoke test failed!')
    console.error(`Error: ${error.message}`)
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2))
    }
    process.exit(1)
  }
}

smokeTest()
