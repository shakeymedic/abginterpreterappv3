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

        const systemPrompt = `You are a hyper-accurate Optical Character Recognition (OCR) engine specifically for blood gas analyser printouts. Your only job is to extract numbers.

CRITICAL: Your entire response MUST be a single, valid JSON object. Do not include markdown, comments, or any other text.

RULES:
1.  **Extract Numbers Only:** Find the corresponding label and extract ONLY the numerical value next to it. Ignore all other symbols, letters, or units (e.g., if you see ">9.0", the value is 9.0).
2.  **Complete All Keys:** The JSON response MUST contain all of the following keys.
3.  **Use null for Missing Values:** If a value for a key cannot be found on the printout, its value MUST be \`null\`.
4.  **Do NOT Convert Units:** Extract the numbers exactly as you see them. The user will handle unit conversions.
5.  **Value Mapping:** Use these common labels to find the correct values:
    * "hb" from "tHb" or "Hb"
    * "hco3" from "cHCO3st", "HCO3(st)", or "HCO3"
    * "glucose" from "Glu"
    * "lactate" from "Lac"
    * "calcium" from "Ca2+" or "iCa"

---

EXAMPLE:
If you see text like this:
"pH 7.31
 pCO2 8.9 kPa
 pO2 7.1 kPa
 Na+ 141 mmol/L
 K+ 5.4 mmol/L
 cHCO3(st) 31.2 mmol/L
 Lac 1.9 mmol/L"

Your response MUST be this exact JSON object:
{
  "ph": 7.31,
  "pco2": 8.9,
  "po2": 7.1,
  "hco3": 31.2,
  "sodium": 141,
  "potassium": 5.4,
  "chloride": null,
  "albumin": null,
  "lactate": 1.9,
  "glucose": null,
  "calcium": null,
  "hb": null
}`;

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
