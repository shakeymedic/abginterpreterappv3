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

        const systemPrompt = `You are an Optical Character Recognition (OCR) engine. Your only job is to extract numbers from a medical report.

**CRITICAL RULE #1: DO NOT DO ANY MATH. DO NOT CONVERT UNITS.**
Extract the numbers EXACTLY as you see them. If you see "pCO2 4.71", the value for "pco2" is 4.71.

**CRITICAL RULE #2: RESPOND WITH JSON ONLY.**
Your entire response must be a single, valid JSON object and nothing else.

The JSON object must contain these keys. If you cannot find a value for a key, use null:
"ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb"

Use the value from "cHCO3st" for the "hco3" key if it is present.`;

        // Create the simplified request payload
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
                temperature: 0.0, // Set to zero for maximum precision
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
            // First, try to parse the entire response as JSON
            extractedJson = JSON.parse(responseText.trim());
        } catch (e1) {
            try {
                // If that fails, remove any markdown code blocks
                let cleanedText = responseText
                    .replace(/```json\s*/gi, '')
                    .replace(/```\s*/g, '')
                    .trim();
                
                // Then try to find the JSON object's boundaries
                const startIndex = cleanedText.indexOf('{');
                const endIndex = cleanedText.lastIndexOf('}');
                
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    const jsonString = cleanedText.substring(startIndex, endIndex + 1);
                    extractedJson = JSON.parse(jsonString);
                } else {
                    throw new Error('No valid JSON structure found in OCR response');
                }
            } catch (e2) {
                console.error('Failed to parse JSON from OCR:', e2, 'Response:', responseText);
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: 'Failed to parse OCR results.' })
                };
            }
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

