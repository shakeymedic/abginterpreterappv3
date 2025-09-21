import { NetlifyKV } from 'netlify:kv';

export default async (req, context) => {
    try {
        const url = new URL(req.url);
        const jobId = url.searchParams.get('id');

        if (!jobId) {
            return new Response(JSON.stringify({ error: 'Job ID is required.' }), { status: 400 });
        }
        
        // Check both the analysis and OCR stores for the job ID.
        const analysisStore = await NetlifyKV.openStore('analysisJobs');
        let result = await analysisStore.get(jobId, { type: 'json' });

        if (!result) {
            const ocrStore = await NetlifyKV.openStore('ocrJobs');
            result = await ocrStore.get(jobId, { type: 'json' });
        }

        if (!result) {
            return new Response(JSON.stringify({ error: 'Job not found.' }), { status: 404 });
        }

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to check job status.' }), { status: 500 });
    }
};
