// netlify/functions/analyze.js

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
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
        body: JSON.stringify({ error: "API key not configured. Please set GEMINI_API_KEY in Netlify." })
      };
    }

    // Default values if missing
    const albumin = values.albumin ?? 42.5; // g/L
    const be = values.be ?? 0; // mmol/L

    // Build structured prompt
    const combinedPrompt = `
You are a consultant in emergency medicine and critical care. Interpret the following blood gas with detailed calculations.

Patient Data (all units standard):
- pH: ${values.ph}
- pCO₂: ${values.pco2} kPa
- pO₂: ${values.po2 ?? "not provided"}
- HCO₃⁻: ${values.hco3 ?? "not provided"}
- Base Excess (BE): ${be}
- Na⁺: ${values.sodium ?? "not provided"}
- K⁺: ${values.potassium ?? "not provided"}
- Cl⁻: ${values.chloride ?? "not provided"}
- Lactate: ${values.lactate ?? "not provided"}
- Albumin: ${albumin} g/L (assumed normal if not provided)
- Glucose: ${values.glucose ?? "not provided"}
- Calcium: ${values.calcium ?? "not provided"}
- Hb: ${values.hb ?? "not provided"}
- Sample type: ${sampleType ?? "not specified"}
- Clinical context: ${clinicalHistory ?? "not provided"}

### Instructions
Provide a full, detailed interpretation, with actual calculations shown step by step.  
If a value is missing, assume normal (and state that assumption).  
Always include Anion Gap, Albumin-corrected AG, Delta ratio, and Base Excess.  
Perform both Henderson–Hasselbalch and Stewart analyses.  
Stewart: calculate SIDa, SIDe, SIG using albumin (assume 42.5 g/L if not given).  
Differentials: provide bullet points with potential causes and next investigations.  
All sections must be detailed and written in Markdown.

### Response Format
Return ONLY a JSON object with these keys.  
Each value must be a multi-line Markdown string with explanations, not a single sentence.

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
      contents: [
        {
          role: "user",
          parts: [{ text: combinedPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 4096
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
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

    // Try to parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      // Remove code fences if present
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "");
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        // Last resort fallback
        parsed = {
          keyFindings: "Unable to parse model output.\n\n" + rawText,
          compensationAnalysis: "",
          hhAnalysis: "",
          stewartAnalysis: "",
          additionalCalculations: "",
          differentials: ""
        };
      }
    }

    // Ensure all keys exist
    const required = [
      "keyFindings",
      "compensationAnalysis",
      "hhAnalysis",
      "stewartAnalysis",
      "additionalCalculations",
      "differentials"
    ];
    for (const k of required) {
      if (!parsed[k]) parsed[k] = "No data provided.";
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    console.error("Analyze function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error", details: err.message })
    };
  }
}
