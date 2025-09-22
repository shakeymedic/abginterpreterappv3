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
                body: JSON.stringify({ error: 'API key not configured. Please set GEMINI_API_KEY in Netlify environment variables.' })
            };
        }

        const { image } = JSON.parse(event.body);
        if (!image) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Image data is required.' })
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        const systemPrompt = `You are a precise Optical Character Recognition (OCR) engine for medical lab reports.
Your entire response MUST be ONLY a single, valid JSON object, starting with { and ending with }. Do not include markdown, comments, or any other text.
RULES:
1. **Numbers Only:** Extract only the numerical value. Ignore ALL other characters or text attached to the number.
2. **Complete Keys:** The JSON must contain all keys: "ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb".
3. **Handle Missing Values:** If a value is not present, its value MUST be null.
4. **Value Mapping:** 
   - "hb" from "tHb" or "Hb"
   - "hco3" from "cHCO3st", "HCO3(st)", "HCO3-", or "HCO3"
   - "glucose" from "Glu" or "Glucose"
   - "lactate" from "Lac" or "Lactate"
   - "calcium" from "Ca2+", "iCa", or "Ca++"
   - "sodium" from "Na+" or "Na"
   - "potassium" from "K+" or "K"
   - "chloride" from "Cl-" or "Cl"
5. **Handle Non-Numerical Values:** If a value is represented by text (e.g., "Error", "---", "N/A") or is otherwise not a number, its value in the JSON MUST be `null`.   
6. **Unit Conversion:** If pCO2 or pO2 values appear to be in mmHg (values > 20), convert to kPa by dividing by 7.5.`;

        const userPrompt = `Extract the blood gas values from this image and return them as a clean JSON object of numbers.`;

        const requestPayload = {
            contents: [{
                parts: [
                    { text: userPrompt },
                    { 
                        inlineData: { 
                            mimeType: "image/jpeg", 
                            data: image 
                        }
                    }
                ]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
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

        // Extract JSON from response
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
            // If no valid JSON is found, throw an error
            throw new Error('No valid JSON structure found in OCR response');
        }
    } catch (e2) {
        // If it still fails, log the error and return a failure response
        console.error('Failed to parse JSON from OCR:', e2);
        console.error('OCR Response was:', responseText);
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
