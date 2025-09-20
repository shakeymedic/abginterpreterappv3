// This is a Node.js serverless function that acts as a secure proxy.
// It is designed to be deployed on platforms like Netlify or Vercel.
// This version is for the Netlify Pro plan, with higher quality prompts.

export default async (req, context) => {
    // 1. We only accept POST requests.
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Allow': 'POST' }
        });
    }

    // 2. Securely get the API key from environment variables.
    //    This is set in your Netlify site settings, NOT here.
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
        
        // This function is now only used for manual interpretation
        const buildManualPrompt = (vals, history, type) => {
            let prompt = `Please interpret the following blood gas results.\nClinical History: ${history || 'Not provided'}\nSample Type: ${type}\n\nValues (all in standard SI units, gases in kPa):\n`;
            for (const [key, value] of Object.entries(vals)) {
                if (value !== null && !isNaN(value)) {
                    prompt += `- ${key}: ${value}\n`;
                }
            }
            return prompt;
        };
        
        const systemPrompt = `You are an expert clinical biochemist and intensive care consultant advising an emergency medicine doctor in the UK. Your task is to interpret blood gas results.
You MUST return your response as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON object.
The JSON object must have the following keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
The value for each key must be a string containing well-structured Markdown.

Here are the instructions for the content of each key:
- "keyFindings": A concise, one-paragraph summary of the overall picture. Then, provide a bulleted list of the 2-3 most likely differential diagnoses based on the results and clinical history.
- "hhAnalysis": Perform a Henderson-Hasselbalch Analysis. Identify the primary disorder, assess compensation (using Winter's formula for metabolic acidosis), calculate and interpret the Anion Gap (AG) = (Na⁺ + K⁺) - (Cl⁻ + HCO₃⁻), the albumin-corrected AG = AG + 0.25 * (40 - Albumin), and the Delta Ratio = (AG - 12) / (24 - HCO₃⁻). For each calculated value, provide a standard UK reference range in brackets. If a value is outside its reference range, **you must wrap the value and its units in a <strong> tag**. For example: pH: <strong>7.15</strong> (7.35-7.45).
- "stewartAnalysis": Perform a Stewart (Physicochemical) Analysis. Calculate SIDa = (Na⁺ + K⁺) - Cl⁻, estimate SIDe ≈ HCO₃⁻ + [Albumin⁻] where [Albumin⁻] = Albumin (g/L) * (0.123 * pH - 0.631), and calculate SIG = SIDa - SIDe. Apply the same formatting for abnormal values as above.
- "additionalCalculations": If FiO₂ is provided and the sample is arterial, calculate the PaO₂/FiO₂ (P/F) Ratio. Formula: P/F Ratio = (PaO₂ in mmHg) / (FiO₂ / 100). Note: 1 kPa = 7.5 mmHg. Assess for ARDS severity based on the Berlin criteria (Mild: 200-300 mmHg, Moderate: 100-200 mmHg, Severe: <100 mmHg). If no FiO₂ is provided, state that the calculation cannot be performed. Apply formatting for abnormal values.
- "differentials": Provide a comprehensive bulleted list of potential differential diagnoses. If the data strongly points to a specific diagnosis (e.g., high glucose and ketones for DKA), **bold that diagnosis** and suggest a single, critical next step in *italics*.`;

        let userPrompt = buildManualPrompt(values, clinicalHistory, sampleType);
        let requestPayload = { contents: [{ parts: [{ text: userPrompt }] }] };

        requestPayload.systemInstruction = { parts: [{ text: systemPrompt }] };

        // 4. Call the Gemini API and forward the response.
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
        
        // We don't parse it here, just send the clean string back
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

