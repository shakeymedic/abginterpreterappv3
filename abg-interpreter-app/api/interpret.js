// This is a Node.js serverless function that acts as a secure proxy.
// It is designed to be deployed on platforms like Netlify or Vercel.
// OPTIMISED VERSION - Aims for faster response time.

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
            let prompt = `Please interpret the following blood gas results.\nClinical History: ${history || 'Not provided'}\nSample Type: ${type}\n\nValues (all in standard SI units, gases in kPa):\n`;
            for (const [key, value] of Object.entries(vals)) {
                if (value !== null && !isNaN(value)) {
                    prompt += `- ${key}: ${value}\n`;
                }
            }
            return prompt;
        };

        const buildImagePrompt = (vals, history, type) => {
            let prompt = `First, perform OCR on the provided image of a blood gas report. Then, using the extracted values and the provided clinical information below, perform a full interpretation.\n`;
            if (vals && vals.fio2 && !isNaN(vals.fio2)) {
                prompt += `The manually entered FiO2 is ${vals.fio2}%.\n`;
            }
            prompt += `Clinical History: ${history || 'Not provided'}\nSample Type: ${type}\nFollow the structured analysis format provided in the system instructions.`;
            return prompt;
        };
        
        // This is the new, streamlined system prompt.
        const systemPrompt = `You are an expert UK-based clinical biochemist and intensive care consultant advising an emergency medicine doctor. Your task is to interpret blood gas results.
You MUST return your response as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON object.
The JSON object must have the following keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
The value for each key must be a string containing clear, well-structured Markdown.

- "keyFindings": A concise, one-paragraph summary of the overall picture. Then, provide a bulleted list of the 2-3 most likely differential diagnoses based on the results and clinical history.
- "hhAnalysis": Perform a Henderson-Hasselbalch Analysis. Identify the primary disorder, assess compensation (using Winter's formula for metabolic acidosis), calculate and interpret the Anion Gap (AG) = (Na⁺ + K⁺) - (Cl⁻ + HCO₃⁻), and the albumin-corrected AG = AG + 0.25 * (40 - Albumin). State the normal ranges for each value in brackets.
- "stewartAnalysis": Perform a Stewart (Physicochemical) Analysis. Calculate SIDa = (Na⁺ + K⁺) - Cl⁻, estimate SIDe ≈ HCO₃⁻ + [Albumin⁻] where [Albumin⁻] = Albumin (g/L) * (0.123 * pH - 0.631), and calculate SIG = SIDa - SIDe.
- "additionalCalculations": If FiO₂ is provided and the sample is arterial, calculate and interpret the PaO₂/FiO₂ (P/F) Ratio. Formula: P/F Ratio = (PaO₂ in mmHg) / (FiO₂ / 100). Note: 1 kPa = 7.5 mmHg.
- "differentials": Provide a comprehensive bulleted list of potential differential diagnoses. **Bold the most likely diagnosis** and suggest a single, critical next step in *italics*.`;

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

