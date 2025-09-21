import { v4 as uuidv4 } from 'uuid';
import { NetlifyKV } from 'netlify:kv';

export default async (req, context) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
        const jobData = await req.json();
        const jobId = uuidv4();
        
        const analysisStore = await NetlifyKV.openStore('analysisJobs');
        await analysisStore.set(jobId, { status: 'pending', data: jobData });

        // Invoke the background function asynchronously
        context.next(null, {
            sendToNetlifyGraph: false,
            functionName: 'process-analysis',
            payload: { jobId, jobData }
        });

        return new Response(JSON.stringify({ jobId }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to start analysis job.' }), { status: 500 });
    }
};
