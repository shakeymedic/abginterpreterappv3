// This is a Node.js serverless function dedicated to fast, robust OCR.
// It is designed to be deployed on platforms like Netlify or Vercel.

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
        // 3. Get the image data from the front-end request.
        const { image } = await req.json();
        
        // 4. A more robust and specific prompt for OCR.
        const systemPrompt = `You are an Optical Character Recognition (OCR) engine specialized for medical lab reports.
Your task is to extract specific blood gas and electrolyte values from the provided image.
You MUST ignore any non-numeric characters attached to the values, such as (+), (-), #, or any other symbols. Extract only the number.
You MUST return your response as a single, valid JSON object. Do not include any text or markdown formatting.
The JSON object should contain keys for "ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb".
The value for each key must be the extracted number. If a value is not found in the image, the value for its key should be null.
For pCO2 and pO2, assume the primary units are kPa unless mmHg is explicitly stated. Return only the numerical value.
Search the entire document for values, including sections like "Metabolites" for "Glu" (glucose). The value for "hb" can be found from "tHb". The value for "hco3" should be taken from "cHCO3" or "HCO3st".`;

        const userPrompt = `Extract the blood gas values from this image and return them as a clean JSON object of numbers.`;

        let requestPayload = {
            contents: [{ parts: [{ text: userPrompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        // 5. Call the Gemini API.
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
        
        // 6. Return the extracted values to the front-end.
        return new Response(cleanedJsonString, {
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

