exports.handler = async (event) => {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'API key not configured.' })
            };
        }

        const { image } = JSON.parse(event.body);
        if (!image) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Image data is required.' })
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are a precise Optical Character Recognition (OCR) engine for medical lab reports.
Your entire response MUST be ONLY a single, valid JSON object, starting with { and ending with }. Do not include markdown, comments, or any other text.
RULES:
1. **Numbers Only:** Extract only the numerical value. Ignore ALL other characters or text attached to the number.
2. **Complete Keys:** The JSON must contain all keys: "ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb".
3. **Handle Missing Values:** If a value is not present, its value MUST be null.
4. **Value Mapping:** "hb" from "tHb", "hco3" from "cHCO3st", "glucose" from "Glu", "lactate" from "Lac", "calcium" from "Ca2+".
5. **Handle Non-Numerical Values:** If a value is text (e.g., "Error", "---"), its value in the JSON MUST be null.
6. **Unit Conversion:** If pCO2 or pO2 values appear to be in mmHg (values > 20), convert to kPa by dividing by 7.5.`;

        // Combine the system instructions and the user prompt
        const combinedPrompt = `${systemPrompt}

---

Based on the rules and instructions above, please extract the values from the following image.`;

        // Create the simplified request payload
        const requestPayload = {
            contents: [{
                parts: [
                    { text: combinedPrompt },
                    { 
                        inlineData: { 
                            mimeType: "image/jpeg", 
                            data: image 
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.1,
                topK: 1,
                topP: 0.95,
                maxOutputTokens: 2048
            }
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API error:', errorText);
            return {
                statusCode: 500,
