import { v4 as uuidv4 } from 'uuid';
import { NetlifyKV } from 'netlify:kv';

export default async (req, context) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
        const jobData = await req.json();
        const jobId = uuidv4();
        
        // Open the key-value store for OCR jobs.
        const ocrStore = await NetlifyKV.openStore('ocrJobs');
        // Store the incoming image data with a 'pending' status.
        await ocrStore.set(jobId, { status: 'pending', data: jobData });

        // Asynchronously trigger the background OCR function, passing the job details.
        context.next(null, {
            sendToNetlifyGraph: false,
            functionName: 'process-ocr',
            payload: { jobId, jobData }
        });

        // Immediately return a '202 Accepted' status with the new job ID.
        return new Response(JSON.stringify({ jobId }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Failed to start OCR job:', error);
        return new Response(JSON.stringify({ error: 'Failed to start OCR job.' }), { status: 500 });
    }
};
