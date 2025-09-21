import { NetlifyKV } from 'netlify:kv';

export default async (event) => {
    const { jobId, jobData } = JSON.parse(event.body);
    const ocrStore = await NetlifyKV.openStore('ocrJobs');

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('API key not configured.');
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        const { image } = jobData;

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

        if (!geminiResponse.ok) throw new Error(await geminiResponse.text());

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error('No content returned from AI.');

        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');
        if (startIndex === -1 || endIndex === -1) throw new Error('AI response did not contain valid JSON.');
        
        const extractedJson = JSON.parse(responseText.substring(startIndex, endIndex + 1));
        
        await ocrStore.set(jobId, { status: 'complete', data: extractedJson });

    } catch (error) {
        await ocrStore.set(jobId, { status: 'failed', error: error.message });
    }
};

