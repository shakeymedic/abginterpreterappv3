// This is a Node.js serverless function dedicated to fast, robust OCR.
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
        const { image } = await req.json();
        
        const systemPrompt = `You are a precise Optical Character Recognition (OCR) engine for medical lab reports.
Your entire response MUST be ONLY a single, valid JSON object, starting with { and ending with }. Do not include markdown, comments, or any other text.
RULES:
1.  **Numbers Only:** Extract only the numerical value. Ignore ALL other characters or text attached to the number.
2.  **Complete Keys:** The JSON must contain all keys: "ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb".
3.  **Handle Missing Values:** If a value is not present, its value MUST be null.
4.  **Value Mapping:** "hb" from "tHb", "hco3" from "cHCO3st" or "HCO3(st)", "glucose" from "Glu", "lactate" from "Lac", "calcium" from "Ca2+".`;

        const userPrompt = `Extract the blood gas values from this image and return them as a clean JSON object of numbers.`;

        const requestPayload = {
            contents: [{ parts: [{ text: userPrompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }],
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
             return new Response(JSON.stringify({ error: 'No valid content returned from the API.' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Robust JSON extraction
        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');

        if (startIndex === -1 || endIndex === -1) {
            console.error("Failed to find valid JSON in AI OCR response:", responseText);
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
        console.error('Error in OCR function:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

