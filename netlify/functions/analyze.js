// netlify/functions/analyze.js

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { values, clinicalHistory, sampleType } = JSON.parse(event.body);
    if (!values?.ph || !values?.pco2) return { statusCode: 400, body: JSON.stringify({ error: "Missing required values (pH and pCO₂ required)." }) };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };

    // Defaults
    const albumin = values.albumin ?? 42.5;
    const be = values.be ?? 0;

    // Pull values
    const ph = values.ph;
    const pco2 = values.pco2; // kPa
    const po2 = values.po2 ?? null;
    const hco3 = values.hco3 ?? null;
    const na = values.sodium ?? null;
    const k = values.potassium ?? null;
    const cl = values.chloride ?? null;

    // Precomputations (basic safety checks)
    const ag = (na ?? 0) + (k ?? 0) - ((cl ?? 0) + (hco3 ?? 0));
    const sida = (na ?? 0) + (k ?? 0) - (cl ?? 0);
    const side = (hco3 ?? 0) + (albumin * 0.25);
    const sig = sida - side;
    const winters = hco3 !== null ? (1.5 * hco3 + 8).toFixed(2) : null;

    const combinedPrompt = `
You are a consultant in emergency medicine and critical care. Interpret the following blood gas with detailed calculations.

⚠️ Important: pCO₂ and pO₂ are always given in kPa. Do NOT convert them.

Patient Data:
- pH: ${ph}
- pCO₂: ${pco2} kPa
- pO₂: ${po2 !== null ? po2 + " kPa" : "not provided"}
- HCO₃⁻: ${hco3 ?? "not provided"}
- Base Excess (BE): ${be}
- Na⁺: ${na ?? "not provided"}
- K⁺: ${k ?? "not provided"}
- Cl⁻: ${cl ?? "not provided"}
- Albumin: ${albumin} g/L
- Clinical context: ${clinicalHistory ?? "not provided"}
- Sample type: ${sampleType ?? "not specified"}

Pre-computed values (for accuracy):
- Anion Gap (AG): ${isNaN(ag) ? "not available" : ag}
- SIDa: ${isNaN(sida) ? "not available" : sida}
- SIDe: ${isNaN(side) ? "not available" : side}
- SIG: ${isNaN(sig) ? "not available" : sig}
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

    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch {
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      parsed = JSON.parse(cleaned);
    }

    const required = ["keyFindings","compensationAnalysis","hhAnalysis","stewartAnalysis","additionalCalculations","differentials"];
    for (const k of required) if (!parsed[k]) parsed[k] = "No data provided.";

    return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" }, body: JSON.stringify(parsed) };
  } catch (err) {
    console.error("Analyze function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error", details: err.message }) };
  }
}
