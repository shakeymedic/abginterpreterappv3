// netlify/functions/ocr.js

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { image } = JSON.parse(event.body);
    if (!image) return { statusCode: 400, body: JSON.stringify({ error: "No image provided." }) };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };

    const ocrGuidedPrompt = `
You are an expert at reading medical blood gas printouts.

Rules:
1) Extract ONLY the measured values from the left-hand result column. Ignore any reference ranges shown in square brackets [ ].
2) All gas values (pCO₂, pO₂) are ALWAYS in kPa. Do NOT convert anything. Ignore any mention of “mmHg”.
3) If a number has flags/symbols (e.g., "+", "#", "*", "↑", "↓", "(+)"), ignore them and return only the numeric part.
4) Each value must be a plain number like "7.26" or "24.1" — no text, units, or symbols.
5) Return a JSON object with these keys (use null if missing):
   ph, pco2, po2, hco3, sodium, potassium, chloride, albumin, lactate, glucose, calcium, hb, be
6) Output only valid JSON, nothing else.
`;

    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: ocrGuidedPrompt },
            { inlineData: { mimeType: "image/jpeg", data: image } }
          ]
        }
      ],
      generationConfig: { temperature: 0, topK: 1, topP: 0.95, maxOutputTokens: 2048 }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestPayload)
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Gemini API error: ${errText}` }) };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) return { statusCode: 500, body: JSON.stringify({ error: "No text output from model." }) };

    // Parse model JSON (strip fences if present)
    let extractedJson;
    try { extractedJson = JSON.parse(rawText); }
    catch {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      extractedJson = JSON.parse(cleaned);
    }

    // Ensure keys exist
    const keys
