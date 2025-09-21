import { v4 as uuidv4 } from 'uuid';
import { NetlifyKV } from 'netlify:kv';

export default async (req, context) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
        const jobData = await req.json();
        const jobId = uuidv4();
        
        // Open the key-value store for analysis jobs.
        const analysisStore = await NetlifyKV.openStore('analysisJobs');
        // Store the incoming data with a 'pending' status.
        await analysisStore.set(jobId, { status: 'pending', data: jobData });

        // Asynchronously trigger the background function, passing the job details.
        // The 'context.next' call does not wait for the background function to finish.
        context.next(null, {
            sendToNetlifyGraph: false,
            functionName: 'process-analysis',
            payload: { jobId, jobData }
        });

        // Immediately return a '202 Accepted' status with the new job ID.
        // This tells the front-end that the job has been successfully submitted.
        return new Response(JSON.stringify({ jobId }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Failed to start analysis job:', error);
        return new Response(JSON.stringify({ error: 'Failed to start analysis job.' }), { status: 500 });
    }
};

