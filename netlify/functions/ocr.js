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

        // NEW, RADICALLY SIMPLIFIED PROMPT
        const systemPrompt = `You are a simple data entry tool. Your only task is to find a specific text label in an image and copy the first numerical value you see next to it.

CRITICAL: Your entire response MUST be a single, valid JSON object and nothing else.

RULES:
1.  **FIND AND COPY:** Find the text label (e.g., "pH", "pCO2", "Lac") and copy the number associated with it.
2.  **NO MATHS:** You must NOT perform any calculations, conversions, or alterations of any kind. Copy the number exactly as it appears.
3.  **JSON ONLY:** The JSON response must contain all the keys listed below.
4.  **NULL FOR MISSING:** If you cannot find a label or its number, the value MUST be \`null\`.
5.  **VALUE MAPPING:** Use these common labels to find the correct values:
    * "hb" from "tHb" or "Hb"
    * "hco3" from "cHCO3st", "HCO3(st)", or "HCO3"
    * "glucose" from "Glu"
    * "lactate" from "Lac"
    * "calcium" from "Ca2+" or "iCa"

This is a simple copy-paste task. Do not try to be clever or helpful. Just find the label and copy the number.`;

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
                responseMimeType: "application/json",
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
            extractedJson = JSON.parse(responseText.trim());
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

