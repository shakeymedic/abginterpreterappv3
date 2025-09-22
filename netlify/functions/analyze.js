// netlify/functions/analyze.js

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
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "API key not configured." })
      };
    }

    // 🔎 unwrap OCR values { value, error, warning } or raw numbers
    const pick = (v) =>
      v && typeof v === "object" && "value" in v ? v.value : v;

    const ph = pick(values.ph);
    const pco2 = pick(values.pco2); // always kPa
    const po2 = pick(values.po2);
    const hco3 = pick(values.hco3);
    const na = pick(values.sodium);
    const k = pick(values.potassium);
    const cl = pick(values.chloride);
    const albumin = pick(values.albumin) ?? 42.5;
    const be = pick(values.be) ?? 0;

    // ✅ Precomputations
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

    // 🔎 Structured prompt
    const combinedPrompt = `
const systemPrompt = `You are an expert clinical biochemist and intensive care consultant advising an emergency medicine doctor in the UK. Your task is to interpret blood gas results.
You MUST return your response as a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON object.
The JSON object must have the following keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".
The value for each key must be a string containing well-structured Markdown.

Here are the instructions for the content of each key:
- "keyFindings": A concise, one-paragraph summary of the overall picture. Then, provide a bulleted list of the 2-3 most likely differential diagnoses based on the results and clinical history.
- "hhAnalysis": Perform a Henderson-Hasselbalch Analysis. Identify the primary disorder, assess compensation (using Winter's formula for metabolic acidosis), calculate and interpret the Anion Gap (AG) = (Na⁺ + K⁺) - (Cl⁻ + HCO₃⁻), the albumin-corrected AG = AG + 0.25 * (40 - Albumin), and the Delta Ratio = (AG - 12) / (24 - HCO₃⁻). For each calculated value, provide a standard UK reference range in brackets. If a value is outside its reference range, **you must wrap the value and its units in a <strong> tag**. For example: pH: <strong>7.15</strong> (7.35-7.45).
- "stewartAnalysis": Perform a Stewart (Physicochemical) Analysis. Calculate SIDa = (Na⁺ + K⁺) - Cl⁻, estimate SIDe ≈ HCO₃⁻ + [Albumin⁻] where [Albumin⁻] = Albumin (g/L) * (0.123 * pH - 0.631), and calculate SIG = SIDa - SIDe. Apply the same formatting for abnormal values as above.
- "additionalCalculations": If FiO₂ is provided and the sample is arterial, calculate the PaO₂/FiO₂ (P/F) Ratio. Formula: P/F Ratio = (PaO₂ in mmHg) / (FiO₂ / 100). Note: 1 kPa = 7.5 mmHg. Assess for ARDS severity based on the Berlin criteria (Mild: 200-300 mmHg, Moderate: 100-200 mmHg, Severe: <100 mmHg). If no FiO₂ is provided, state that the calculation cannot be performed. Apply formatting for abnormal values.
- "differentials": Provide a comprehensive bulleted list of potential differential diagnoses. If the data strongly points to a specific diagnosis (e.g., high glucose and ketones for DKA), **bold that diagnosis** and suggest a single, critical next step in *italics*.`;


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

Pre-computed values (server-side for accuracy):
- Anion Gap (AG): ${ag ?? "not available"}
- SIDa: ${sida ?? "not available"}
- SIDe: ${side ?? "not available"}
- SIG: ${sig ?? "not available"}
- Winter's expected pCO₂: ${winters ?? "not available"}

### Instructions
1. Provide **Key Findings**.  
2. Do **Compensation Analysis** using Winter’s formula, expected HCO₃⁻, acute/chronic respiratory rules.  
3. Provide a full **Henderson–Hasselbalch Analysis** with pH, pCO₂, HCO₃⁻ interpretation, and observed vs expected values.  
4. Provide a full **Stewart Analysis** (SIDa, SIDe, SIG), explain significance.  
5. Provide **Additional Calculations**: AG, albumin-corrected AG, delta ratio, Base Excess interpretation.  
6. Provide **Differentials**: bullet points, likely causes, and next steps.  
7. All sections must be detailed Markdown (use headings ### and bullet points).  

### Response Format
Return ONLY a JSON object with these keys:
{
  "keyFindings": "...",
  "compensationAnalysis": "...",
  "hhAnalysis": "...",
  "stewartAnalysis": "...",
  "additionalCalculations": "...",
  "differentials": "..."
}
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
