// netlify/functions/ocr.js
// OCR + parsing using Gemini 2.5 Flash with strict JSON rules

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { image } = JSON.parse(event.body || "{}");
    if (!image) return badRequest("No image provided.");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return serverError("GEMINI_API_KEY not configured.");

    const ocrPrompt = `
You are an OCR engine for blood gas (ABG/VBG) printouts.

Your ONLY task is to extract **measured values** into JSON.

Rules:
1. Return JSON ONLY. No text, no explanation, no markdown.
2. Use these keys (null if missing): 
   ph, pco2, po2, hco3, sodium, potassium, chloride, albumin, lactate, glucose, calcium, hb, be
3. pCO₂ and pO₂ are ALWAYS reported in kPa. Ignore any mention of mmHg or %.
4. Ignore reference ranges (values in [ ] or parentheses that are not the measured result).
5. Strip all symbols: +, -, #, *, ↑, ↓, ( ), (+), etc.
6. Each value must be a plain number (e.g. 7.26, 24.1). No units.
7. If the result is unreadable, return null for that key.
`;

    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: ocrPrompt },
            { inlineData: { mimeType: "image/jpeg", data: image } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        topK: 1,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
    if (!rawText) return serverError("No text output from Gemini.");

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      parsed = JSON.parse(cleaned);
    }

    const keys = [
      "ph","pco2","po2","hco3","sodium","potassium","chloride",
      "albumin","lactate","glucose","calcium","hb","be"
    ];
    for (const k of keys) if (!(k in parsed)) parsed[k] = null;

    // cleanup + bounds checking
    const toNum = (v) => {
      if (v == null) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        const cleaned = v.replace(/[^0-9.+-]/g, "").replace(",", ".");
        const num = parseFloat(cleaned);
        return Number.isFinite(num) ? num : null;
      }
      return null;
    };

    const bounds = {
      ph: [6.0, 8.0],
      pco2: [0.5, 30],
      po2: [0.5, 100],
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

    const out = {};
    for (const k of keys) {
      const num = toNum(parsed[k]);
      const [min, max] = bounds[k] ?? [-Infinity, Infinity];
      if (num == null) {
        out[k] = { value: null, error: "Value missing or unreadable.", warning: null };
      } else if (num < min || num > max) {
        out[k] = { value: null, error: `Value ${num} outside physiological range (${min}–${max}).`, warning: null };
      } else {
        out[k] = { value: num, error: null, warning: null };
      }
    }

    // auto-fix ÷7.5 bug for gases
    const fixDivide7_5 = (key, threshold, physRange) => {
      const item = out[key];
      if (item?.value != null && item.value < threshold) {
        const corrected = +(item.value * 7.5).toFixed(3);
        if (corrected >= physRange[0] && corrected <= physRange[1]) {
          item.value = corrected;
          item.warning = `Auto-corrected ${key.toUpperCase()} (suspected ÷7.5 error).`;
        }
      }
    };
    fixDivide7_5("pco2", 2.5, bounds.pco2);
    fixDivide7_5("po2", 3.0, bounds.po2);

    return ok(out);

  } catch (err) {
    console.error("OCR error:", err);
    return serverError(err.message || "Internal server error.");
  }
}

/* ---------------- helpers ---------------- */
const ok = (body) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  body: JSON.stringify(body)
});
const badRequest = (msg) => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverError = (msg) => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });
