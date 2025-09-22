// netlify/functions/ocr.js

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { image } = JSON.parse(event.body);

    if (!image) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image provided." })
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "API key not configured. Please set GEMINI_API_KEY in Netlify."
        })
      };
    }

    // 🔒 Updated OCR prompt
    const ocrGuidedPrompt = `
You are an expert at reading medical blood gas printouts.

Rules:
1. Extract ONLY the measured values, not the reference ranges.
2. All gas values (pCO₂, pO₂) must always be in kPa. Do NOT convert anything.
3. If a number has flags or symbols (e.g. "+", "#", "*", "↑", "↓"), ignore them and return only the numeric part.
4. Ignore any units or text. Only output the number itself.
5. Return a JSON object with these keys:
   - ph
   - pco2
   - po2
   - hco3
   - sodium
   - potassium
   - chloride
   - albumin
   - lactate
   - glucose
   - calcium
   - hb
   - be
6. If a value is missing, set it to null.
7. Use plain numbers (no units, no symbols).
8. Output only valid JSON, nothing else.
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
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 0.95,
        maxOutputTokens: 2048
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestPayload)
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Gemini API error: ${errText}` })
      };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!rawText) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No text output from model." })
      };
    }

    let extractedJson;
    try {
      extractedJson = JSON.parse(rawText);
    } catch (err) {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      try {
        extractedJson = JSON.parse(cleaned);
      } catch (e) {
        // Fallback: wrap raw in object
        extractedJson = {
          error: "Unable to parse OCR output.",
          raw: rawText
        };
      }
    }

    // Ensure all required keys exist
    const requiredKeys = [
      "ph",
      "pco2",
      "po2",
      "hco3",
      "sodium",
      "potassium",
      "chloride",
      "albumin",
      "lactate",
      "glucose",
      "calcium",
      "hb",
      "be"
    ];
    for (const k of requiredKeys) {
      if (!(k in extractedJson)) extractedJson[k] = null;
    }

    // ✅ Clean numeric fields
    function cleanNumber(val) {
      if (val === null || val === undefined) return null;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.+-]/g, ""); // strip non-numeric chars
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      }
      return null;
    }

    for (const k of requiredKeys) {
      extractedJson[k] = cleanNumber(extractedJson[k]);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      },
      body: JSON.stringify(extractedJson)
    };
  } catch (err) {
    console.error("OCR function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        details: err.message
      })
    };
  }
}
