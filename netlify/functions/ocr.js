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

        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

        // Simplified prompt, as the JSON schema now enforces the structure.
        const systemPrompt = `You are an Optical Character Recognition (OCR) engine. Extract numbers from the medical report.
- **CRITICAL RULE**: Do NOT perform any mathematical calculations or unit conversions. Extract the numbers EXACTLY as you see them.
- Use the value from "cHCO3st" for the "hco3" key if present.
- If a value is not present, it must be null.`;

        // Create the request payload WITH JSON MODE ENABLED
        const requestPayload = {
            contents: [{
                parts: [
                    { text: systemPrompt },
                    { 
                        inlineData: { 
                            mimeType: "image/jpeg", 
                            data: image 
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.0,
                // This forces the model to output valid JSON matching the schema
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "ph": { "type": "NUMBER" },
                        "pco2": { "type": "NUMBER" },
                        "po2": { "type": "NUMBER" },
                        "hco3": { "type": "NUMBER" },
                        "sodium": { "type": "NUMBER" },
                        "potassium": { "type": "NUMBER" },
                        "chloride": { "type": "NUMBER" },
                        "albumin": { "type": "NUMBER", "nullable": true },
                        "lactate": { "type": "NUMBER" },
                        "glucose": { "type": "NUMBER" },
                        "calcium": { "type": "NUMBER" },
                        "hb": { "type": "NUMBER" }
                    },
                },
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
                body: JSON.stringify({ error: 'OCR processing failed. Please try again.' })
            };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'No content returned from OCR.' })
            };
        }

        let extractedJson;
        try {
            // Because we are using JSON mode, the responseText *is* the JSON string.
            // We no longer need to search for ```json or {}.
            extractedJson = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse JSON from OCR:', e, 'Response:', responseText);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to parse OCR results.' })
            };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(extractedJson)
        };

    } catch (error) {
        console.error('OCR function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An unexpected error occurred during OCR processing.' })
        };
    }
};

