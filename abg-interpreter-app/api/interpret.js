// This is a Node.js serverless function that acts as a secure proxy.
// It is designed to be deployed on platforms like Netlify or Vercel.
// HYPER-OPTIMISED VERSION - Aims for response time under 10 seconds.

export default async (req, context) => {
    // 1. We only accept POST requests.
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Allow': 'POST' }
        });
    }

    // 2. Securely get the API key from environment variables.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
         return new Response(JSON.stringify({ error: 'API key is not configured on the server.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
        // 3. Get the data from the front-end request.
        const { mode, values, clinicalHistory, sampleType, image } = await req.json();
        
        const buildManualPrompt = (vals, history, type) => {
            let prompt = `Interpret these blood gas results.\nHistory: ${history || 'None'}\nType: ${type}\n\nValues (SI units, kPa):\n`;
            for (const [key, value] of Object.entries(vals)) {
                if (value !== null && !isNaN(value)) {
                    prompt += `- ${key}: ${value}\n`;
                }
            }
            return prompt;
        };

        const buildImagePrompt = (vals, history, type) => {
            let prompt = `Perform OCR on the image and interpret the extracted blood gas values.\n`;
            if (vals && vals.fio2 && !isNaN(vals.fio2)) {
                prompt += `Manually entered FiO2: ${vals.fio2}%.\n`;
            }
            prompt += `History: ${history || 'None'}\nType: ${type}\nFollow the required JSON output format.`;
            return prompt;
        };
        
        // This is the new, hyper-streamlined system prompt for maximum speed.
        const systemPrompt = `You are an expert UK-based clinical biochemist. Interpret blood gas results and return a single, valid JSON object with no other text.
The JSON object must have keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
The value for each key must be a Markdown string. Be concise and fast.

- "keyFindings": 1-paragraph summary and the top 3 differentials.
- "hhAnalysis": Henderson-Hasselbalch analysis. State primary disorder, compensation, Anion Gap, and albumin-corrected AG. Include normal ranges.
- "stewartAnalysis": Stewart analysis. State SIDa, SIDe, and SIG.
- "additionalCalculations": If arterial with FiO₂, calculate and interpret the P/F Ratio.
- "differentials": A comprehensive bulleted list of differentials. State the most likely diagnosis first.`;

        let userPrompt;
        let requestPayload;

        if (mode === 'manual') {
            userPrompt = buildManualPrompt(values, clinicalHistory, sampleType);
            requestPayload = { contents: [{ parts: [{ text: userPrompt }] }] };
        } else { // Image mode
            userPrompt = buildImagePrompt(values, clinicalHistory, sampleType);
            requestPayload = { contents: [{ parts: [{ text: userPrompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }] };
        }

        requestPayload.systemInstruction = { parts: [{ text: systemPrompt }] };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            console.error('Gemini API Error:', errorBody);
            return new Response(JSON.stringify({ error: `Error from Gemini API: ${errorBody}` }), {
                status: geminiResponse.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await geminiResponse.json();
        const jsonString = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonString) {
             return new Response(JSON.stringify({ error: 'No valid content returned from the API.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const cleanedJsonString = jsonString.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        
        return new Response(cleanedJsonString, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error in proxy function:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

