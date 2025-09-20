// This is a Node.js serverless function that acts as a secure proxy.
// It is designed to be deployed on platforms like Netlify or Vercel.
// This version includes robust JSON cleaning to handle imperfect AI responses.

export default async (req, context) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Allow': 'POST' }
        });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
         return new Response(JSON.stringify({ error: 'API key is not configured on the server.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
        const { values, clinicalHistory, sampleType } = await req.json();
        
        const buildManualPrompt = (vals, history, type) => {
            let prompt = `Please interpret the following blood gas results.\nClinical History: ${history || 'Not provided'}\nSample Type: ${type}\n\nValues (all in standard SI units, gases in kPa):\n`;
            for (const [key, value] of Object.entries(vals)) {
                if (value !== null && !isNaN(value)) {
                    prompt += `- ${key}: ${value}\n`;
                }
            }
            return prompt;
        };
        
        const systemPrompt = `You are an expert clinical biochemist. Your task is to interpret blood gas results.
Your entire response MUST be ONLY a single, valid JSON object, starting with { and ending with }. Do not include markdown, comments, or any other text.
The JSON object must have keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
The value for each key must be a string containing well-structured Markdown.

If the provided values are clinically implausible, your "keyFindings" should clearly state this and recommend checking for a data entry or lab error, and the other keys should contain "Analysis not performed.".

For valid data:
- "keyFindings": A concise summary and the top 3 differentials.
- "hhAnalysis": Perform a Henderson-Hasselbalch Analysis. Identify the primary disorder, assess compensation, calculate and interpret the Anion Gap, albumin-corrected AG, and Delta Ratio. Include UK reference ranges. **Bold** any abnormal values.
- "stewartAnalysis": Perform a Stewart Analysis. Calculate SIDa, SIDe, and SIG.
- "additionalCalculations": If FiO₂ is provided and the sample is arterial, calculate and interpret the P/F Ratio.
- "differentials": A comprehensive bulleted list of potential diagnoses. **Bold the most likely diagnosis** and suggest a single critical next step in *italics*.`;

        const userPrompt = buildManualPrompt(values, clinicalHistory, sampleType);
        const requestPayload = { 
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            return new Response(JSON.stringify({ error: `Error from Gemini API: ${errorBody}` }), {
                status: geminiResponse.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
             return new Response(JSON.stringify({ error: 'No valid content was returned from the AI model.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Robust JSON extraction
        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');
        
        if (startIndex === -1 || endIndex === -1) {
            console.error("Failed to find valid JSON in AI response:", responseText);
            return new Response(JSON.stringify({ error: 'AI response did not contain a valid JSON object.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const extractedJson = responseText.substring(startIndex, endIndex + 1);
        
        return new Response(extractedJson, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error in interpret function:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

