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
    const keys = ["ph","pco2","po2","hco3","sodium","potassium","chloride","albumin","lactate","glucose","calcium","hb","be"];
    for (const k of keys) if (!(k in extractedJson)) extractedJson[k] = null;

    // Clean numeric strings like "24.1 (+)" -> 24.1
    const toNum = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return isFinite(v) ? v : null;
      if (typeof v === "string") {
        const cleaned = v.replace(/[^0-9.+-]/g, "");
        const num = parseFloat(cleaned);
        return Number.isFinite(num) ? num : null;
      }
      return null;
    };

    // Wide physiological bounds (kPa where applicable)
    const bounds = {
      ph: [6.0, 8.0],
      pco2: [0.5, 30],     // kPa
      po2: [0.5, 100],     // kPa
      hco3: [2, 60],
      sodium: [80, 200],
      potassium: [1, 12],
      chloride: [50, 150],
      albumin: [10, 70],
      lactate: [0, 30],
      glucose: [0, 80],
      calcium: [0.2, 5],
      hb: [30, 250],
      be: [-50, 50]
    };

    // Build output { value, error, warning }
    const out = {};
    for (const k of keys) {
      const num = toNum(extractedJson[k]);
      const [min, max] = bounds[k] ?? [-Infinity, Infinity];
      if (num === null) {
        out[k] = { value: null, error: "Value missing or unreadable.", warning: null };
      } else if (num < min || num > max) {
        out[k] = { value: null, error: `Value ${num} outside physiological range (${min}–${max}).`, warning: null };
      } else {
        out[k] = { value: num, error: null, warning: null };
      }
    }

    // 🔧 Auto-correct the classic "divided by 7.5" error for gases
    const tryCorrect = (key, lowThresh, physMin, physMax) => {
      const item = out[key];
      if (!item || item.value == null) return;
      const v = item.value;
      if (v < lowThresh) {
        const corrected = +(v * 7.5).toFixed(3);
        if (corrected >= physMin && corrected <= physMax) {
          item.value = corrected;
          item.warning = `Auto-corrected ${key.toUpperCase()} (value looked divided by 7.5; multiplied to restore kPa).`;
        }
      }
    };

    tryCorrect("pco2", 2.5, 0.5, 30);  // if <2.5 kPa, treat as likely divided by 7.5
    tryCorrect("po2", 3.0, 0.5, 100);  // if <3 kPa, treat as likely divided by 7.5

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(out)
    };
  } catch (err) {
    console.error("OCR function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error", details: err.message }) };
  }
}
