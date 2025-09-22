exports.handler = async (event) => {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'API key not configured.' })
            };
        }

        const { values, clinicalHistory, sampleType } = JSON.parse(event.body);

        if (!values || !values.ph || !values.pco2) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'pH and pCO2 values are required for analysis.' })
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

        // UPGRADED PROMPT FOR CONSULTANT-LEVEL JOINT EM/ICU ANALYSIS
        const systemPrompt = `You are a consultant-level clinical decision support tool. Your entire analysis must reflect a joint consensus between a senior UK-based Intensive Care consultant and a senior UK-based Emergency Medicine consultant, providing a synthesis of both perspectives. Your response must be a single, valid JSON object. For each key, provide a detailed, well-structured markdown string.

The JSON must have these exact keys: "keyFindings", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials"

INSTRUCTIONS FOR EACH KEY'S CONTENT:

"keyFindings": A concise summary paragraph from a joint EM/ICU perspective. State the primary physiological insults, compensation status, and critical life-threats. You MUST include the top three most likely differential diagnoses.

"hhAnalysis": This section must be highly detailed.
1.  **Main Heading:** "Henderson-Hasselbalch Analysis".
2.  **List Values:** List pH, pCO₂, and HCO₃⁻ with normal ranges and a brief interpretation.
3.  **Primary Disorder & Compensation Heading:** Create a bolded sub-heading. State the final diagnosis.
4.  **Evidence Sections:** For mixed disorders, you MUST include bolded "Evidence for..." sub-headings. Under each, explain the reasoning and show the expected compensation calculation (e.g., Winter's formula) to prove the co-existence of the other disorder.
5.  **Calculated Values Heading:** Create a bolded sub-heading. Show full calculations for Anion Gap, and state when Albumin-corrected AG or Delta Ratio cannot be reliably calculated, explaining why.

"stewartAnalysis": This must also be highly detailed.
1.  **Main Heading:** "Stewart (Physicochemical) Analysis".
2.  **Calculations:** Show full calculations for SIDa, SIDe, and SIG. State when they cannot be calculated due to missing data.
3.  **Clinical Interpretation:** If SIG is high, you must provide a paragraph explaining its clinical significance as the primary driver of the metabolic acidosis due to unmeasured anions (ketones, lactate, toxins etc.).

"additionalCalculations":
1.  **Main Heading:** "Additional Calculations".
2.  Calculate the P/F Ratio if FiO₂ is provided. Explain why it cannot be calculated for venous samples.

"differentials": This section must be structured like a joint EM/ICU management plan.
1.  **Main Heading:** "Potential Differential Diagnoses & Management Plan".
2.  For each significant abnormality (e.g., "High Anion Gap Metabolic Acidosis (HAGMA)"), create a bolded sub-heading.
3.  Under each sub-heading, list the potential causes with a brief rationale.
4.  Crucially, for each cause, you MUST include two distinct, actionable lines:
    * \`Immediate ED Actions:\` outlining critical next steps for resuscitation and investigation in the ED.
    * \`Anticipated ICU Plan:\` outlining potential next-level supportive care, monitoring, and treatment over the next 24-48 hours.`;
        
        const patientDataPrompt = `Clinical History: ${clinicalHistory || 'Not provided'}\nSample Type: ${sampleType || 'Arterial'}\nValues:\n`;
        let valuesForPrompt = '';
        
        const analysisValues = { ...values };
        if (analysisValues.albumin === null || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 40; // Assume normal if not provided
        }

        const valueMapping = {
            ph: 'pH', pco2: 'pCO₂ (kPa)', po2: 'pO₂ (kPa)', hco3: 'HCO₃⁻ (mmol/L)',
            sodium: 'Na⁺ (mmol/L)', potassium: 'K⁺ (mmol/L)', chloride: 'Cl⁻ (mmol/L)',
            albumin: 'Albumin (g/L)', lactate: 'Lactate (mmol/L)', glucose: 'Glucose (mmol/L)',
            calcium: 'Ionised Ca²⁺ (mmol/L)', hb: 'Hb (g/L)', fio2: 'FiO₂ (%)'
        };

        for (const [key, label] of Object.entries(valueMapping)) {
            if (values[key] !== null && values[key] !== undefined && !isNaN(values[key])) {
                if (key === 'albumin' && !values.albumin) {
                    valuesForPrompt += `- ${label}: ${analysisValues[key]} (assumed normal)\n`;
                } else {
                    valuesForPrompt += `- ${label}: ${values[key]}\n`;
                }
            }
        }

        const combinedPrompt = `${systemPrompt}\n\n---\n\nBased on the rules above, please analyze the following blood gas:\n${patientDataPrompt}${valuesForPrompt}`;

        const requestPayload = {
            contents: [{ parts: [{ text: combinedPrompt }] }],
            generationConfig: {
                temperature: 0.1,
                topK: 1,
                topP: 0.8,
                maxOutputTokens: 8192,
                responseMimeType: "application/json",
            }
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API error:', errorText);
            return { statusCode: 500, body: JSON.stringify({ error: 'Analysis failed. Please try again.' }) };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            return { statusCode: 500, body: JSON.stringify({ error: 'No analysis content returned from AI.' }) };
        }

        let extractedJson;
        try {
            extractedJson = JSON.parse(responseText.trim());
        } catch (e) {
            console.error('Failed to parse JSON:', e, 'Response was:', responseText);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to parse analysis results.' }) };
        }
        
        const requiredKeys = ['keyFindings', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
        for (const key of requiredKeys) {
            if (!extractedJson[key]) {
                extractedJson[key] = 'Not performed for this analysis.';
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
            body: JSON.stringify(extractedJson)
        };

    } catch (error) {
        console.error('Analysis function error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'An unexpected error occurred during analysis: ' + error.message }) };
    }
};

