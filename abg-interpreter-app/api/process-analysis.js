import { NetlifyKV } from 'netlify:kv';

export default async (event) => {
    const { jobId, jobData } = JSON.parse(event.body);
    const analysisStore = await NetlifyKV.openStore('analysisJobs');

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('API key not configured.');

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        const { values, clinicalHistory, sampleType } = jobData;

        const systemPrompt = `You are an expert clinical biochemist. Your task is to interpret blood gas results.
Your entire response MUST be ONLY a single, valid JSON object, starting with { and ending with }. Do not include markdown, comments, or any other text.
The JSON object must have keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
If values are implausible, "keyFindings" must state this and recommend checking for errors; other keys should contain "Analysis not performed.".
For valid data:
- "keyFindings": Concise summary and top 3 differentials.
- "hhAnalysis": Henderson-Hasselbalch analysis with Anion Gap, corrected AG, and Delta Ratio. Include UK ranges. **Bold** abnormal values.
- "stewartAnalysis": Stewart Analysis with SIDa, SIDe, and SIG.
- "additionalCalculations": P/F Ratio if applicable.
- "differentials": Full list of differentials. **Bold** the most likely.`;
        
        let prompt = `Interpret:\nHistory: ${clinicalHistory || 'None'}\nType: ${sampleType}\nValues:\n`;
        for (const [key, value] of Object.entries(values)) {
            if (value !== null && !isNaN(value)) prompt += `- ${key}: ${value}\n`;
        }
        
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });

        if (!geminiResponse.ok) throw new Error(await geminiResponse.text());

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error('No content returned from AI.');

        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');
        if (startIndex === -1 || endIndex === -1) throw new Error('AI response did not contain valid JSON.');
        
        const extractedJson = JSON.parse(responseText.substring(startIndex, endIndex + 1));

        await analysisStore.set(jobId, { status: 'complete', data: extractedJson });

    } catch (error) {
        await analysisStore.set(jobId, { status: 'failed', error: error.message });
    }
};
