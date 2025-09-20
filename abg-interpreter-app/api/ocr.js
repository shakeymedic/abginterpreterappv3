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
        
        // 4. A hyper-specific and robust prompt for OCR.
        const systemPrompt = `You are an extremely precise Optical Character Recognition (OCR) engine for medical lab reports.
Your only task is to extract specific numerical values from an image and return them in a JSON object.
RULES:
1.  **Numbers Only:** You MUST extract only the numerical value. Ignore ALL other characters, symbols, or text attached to the number, including (+), (-), #, brackets, and units.
2.  **Strict JSON Output:** You MUST return your response as a single, valid JSON object. Do not include any text, notes, or markdown formatting before or after the JSON object.
3.  **Complete Keys:** The JSON object must contain all of the following keys: "ph", "pco2", "po2", "hco3", "sodium", "potassium", "chloride", "albumin", "lactate", "glucose", "calcium", "hb".
4.  **Handle Missing Values:** If a value for any key is not present in the image, its value in the JSON object MUST be null. Do not omit the key.
5.  **Value Mapping:**
    - "hb" comes from the value for "tHb".
    - "hco3" comes from the value for "cHCO3st" or "HCO3(st)". If both "cHCO3st" and "cHCO3-" are present, you MUST prioritize "cHCO3st".
    - "glucose" comes from the value for "Glu".
    - "lactate" comes from the value for "Lac".
    - "calcium" comes from the value for "Ca2+".
6.  **Units:** Assume pCO2 and pO2 are in kPa. Return only the number.
Your output must be flawless, clean JSON.`;

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

