// netlify/functions/analyze.js
// Detailed ABG analysis using Gemini 2.5 Flash

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { values, clinicalHistory, sampleType } = JSON.parse(event.body);
    if (!values?.ph || !values?.pco2) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required values (pH and pCO₂ required)." })
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };
    }

    // unwrap OCR { value, error, warning } or plain numbers
    const pick = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

    const ph = pick(values.ph);
    const pco2 = pick(values.pco2); // always kPa
    const po2 = pick(values.po2);
    const hco3 = pick(values.hco3);
    const na = pick(values.sodium);
    const k = pick(values.potassium);
    const cl = pick(values.chloride);
    const albumin = pick(values.albumin) ?? 42.5;
    const be = pick(values.be) ?? 0;

    // precomputations
    const ag = na != null && k != null && cl != null && hco3 != null
      ? (na + k - (cl + hco3)).toFixed(2)
      : null;
    const sida = na != null && k != null && cl != null
      ? (na + k - cl).toFixed(2)
      : null;
    const side = hco3 != null
      ? (hco3 + albumin * 0.25).toFixed(2)
      : null;
    const sig = sida != null && side != null
      ? (parseFloat(sida) - parseFloat(side)).toFixed(2)
      : null;
    const winters = hco3 != null
      ? (1.5 * hco3 + 8).toFixed(2)
      : null;

    // structured prompt
    const combinedPrompt = `
You are an expert clinical biochemist and intensive care consultant advising an emergency medicine doctor in the UK. Your task is to interpret blood gas results.

You MUST return your response as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON object.

The JSON object must have the following keys:
"keyFindings", "compensationAnalysis", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".

The value for each key must be a string containing well-structured Markdown.

Instructions for each section:
- "keyFindings": A concise, one-paragraph summary of the overall picture. Then, provide a bulleted list of the 2–3 most likely differential diagnoses.
- "compensationAnalysis": Assess compensation (e.g. Winter's formula for metabolic acidosis, expected HCO₃⁻ for respiratory disorders). Compare expected vs observed values.
- "hhAnalysis": Perform a Henderson–Hasselbalch Analysis. Include pH, pCO₂, HCO₃⁻, Anion Gap (AG), albumin-corrected AG, Delta Ratio. For each, show reference ranges in brackets. If a value is abnormal, wrap it in <strong> tags.
- "stewartAnalysis": Perform Stewart (Physicochemical) Analysis. Calculate SIDa = (Na⁺+K⁺)–Cl⁻, SIDe ≈ HCO₃⁻+[Albumin⁻], SIG = SIDa–SIDe. Apply the same formatting for abnormal values.
- "additionalCalculations": Include P/F ratio if FiO₂ available and sample is arterial (convert kPa → mmHg using 1 kPa = 7.5 mmHg). Comment on Base Excess. Add any other relevant derived values.
- "differentials": Provide a bulleted list of potential differential diagnoses. Bold the most likely diagnosis and suggest a single *critical next step*.

⚠️ Important: pCO₂ and pO₂ values are always provided in kPa. Do NOT convert them.

Patient Data:
- pH: ${ph}
- pCO₂: ${pco2} kPa
- pO₂: ${po2 !== null && po2 !== undefined ? po2 + " kPa" : "not provided"}
- HCO₃⁻: ${hco3 ?? "not provided"} mmol/L
- Base Excess (BE): ${be} mmol/L
- Na⁺: ${na ?? "not provided"} mmol/L
- K⁺: ${k ?? "not provided"} mmol/L
- Cl⁻: ${cl ?? "not provided"} mmol/L
- Albumin: ${albumin} g/L
- Clinical context: ${clinicalHistory ?? "not provided"}
- Sample type: ${sampleType ?? "not specified"}

Pre-computed values (server-side):
- Anion Gap (AG): ${ag ?? "not available"}
- SIDa: ${sida ?? "not available"}
- SIDe: ${side ?? "not available"}
- SIG: ${sig ?? "not available"}
- Winter's expected pCO₂: ${winters ?? "not available"}
`;

    const requestPayload = {
      contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
      generationConfig: { temperature: 0.2, topK: 1, topP: 0.8, maxOutputTokens: 4096 }
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
    if (!rawText) {
      return { statusCode: 500, body: JSON.stringify({ error: "No text output from model." }) };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      parsed = JSON.parse(cleaned);
    }

    const required = [
      "keyFindings",
      "compensationAnalysis",
      "hhAnalysis",
      "stewartAnalysis",
      "additionalCalculations",
      "differentials"
    ];
    for (const k of required) if (!parsed[k]) parsed[k] = "No data provided.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    console.error("Analyze function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error", details: err.message }) };
  }
}
