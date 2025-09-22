// netlify/functions/ocr.js

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { image } = JSON.parse(event.body);
    if (!image) return { statusCode: 400, body: JSON.stringify({ error: "No image provided." }) };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };
    }

    const ocrGuidedPrompt = `
You are an expert at reading medical blood gas printouts.

Rules:
1. Extract ONLY measured values (not reference ranges).
2. All gas values (pCO₂, pO₂) are always in kPa. Do NOT convert anything.
3. If a number has flags or symbols (e.g. "+", "#", "*", "↑", "↓"), ignore them and return only the numeric part.
4. Each value must be a plain number like "7.26" or "24.1". No text, units, or symbols.
5. Return a JSON object with these keys:
   ph, pco2, po2, hco3, sodium, potassium, chloride, albumin, lactate, glucose, calcium, hb, be
6. If a value is missing, set it to null.
7. Output only valid JSON.
`;

    const requestPayload = {
      contents: [{ role: "user", parts: [{ text: ocrGuidedPrompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }],
      generationConfig: { temperature: 0, topK: 1, topP: 0.95, maxOutputTokens: 2048 }
    };

    const response = await fetch("https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Gemini API error: ${errText}` }) };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) return { statusCode: 500, body: JSON.stringify({ error: "No text output from model." }) };

    let extractedJson;
    try {
      extractedJson = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      extractedJson = JSON.parse(cleaned);
    }

    const requiredKeys = ["ph","pco2","po2","hco3","sodium","potassium","chloride","albumin","lactate","glucose","calcium","hb","be"];
    for (const k of requiredKeys) if (!(k in extractedJson)) extractedJson[k] = null;

    // Clean + bounds
    function cleanNumber(val) {
      if (val === null || val === undefined) return null;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.+-]/g, "");
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      }
      return null;
    }

    // Expanded bounds (deliberately wide to allow extremes)
    const ranges = {
      ph: [6.0, 8.0],
      pco2: [0.5, 30],   // kPa
      po2: [0.5, 100],   // kPa
      hco3: [2, 60],
      sodium: [80, 200],
      potassium: [1, 12],
      chloride: [50, 150],
      albumin: [10, 70],
      lactate: [0, 30],
      glucose: [0, 80],
      calcium: [0.2, 5],
      hb: [30, 250],
      be: [-50, +50]
    };

    for (const k of requiredKeys) {
      const num = cleanNumber(extractedJson[k]);
      if (num === null) { extractedJson[k] = null; continue; }
      const [min, max] = ranges[k];
      extractedJson[k] = (num < min || num > max) ? null : num;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(extractedJson)
    };
  } catch (err) {
    console.error("OCR function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error", details: err.message }) };
  }
}
