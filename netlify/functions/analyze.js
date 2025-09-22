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

        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are an expert clinical biochemist and intensivist providing a detailed, registrar-level blood gas analysis for an emergency medicine doctor in the UK.

CRITICAL: Your ENTIRE response must be ONLY a valid JSON object, starting with { and ending with }. Do not include markdown formatting or any other text.

The JSON must have these exact keys: "keyFindings", "compensationAnalysis", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".

FORMATTING RULES:
- All text values must be strings.
- Use markdown's double asterisks (e.g., **Metabolic Acidosis**) for emphasis.

ANALYSIS INSTRUCTIONS:

1.  **"keyFindings"**: Provide a concise summary paragraph synthesising the results. It MUST state the primary disorder(s), the status of compensation, any critical values, and finish by explicitly listing the **Top 3 Differential Diagnoses**.

2.  **"compensationAnalysis"**: Perform and show calculations for expected compensation. Crucially, provide a narrative explaining the evidence for your conclusion (e.g., "The observed pCO2 is significantly higher than the expected compensation of 4.5 kPa, confirming a co-existing respiratory acidosis.").
    * Metabolic Acidosis: Use Winter's formula (Expected pCO2 kPa = (1.5 * HCO3 + 8) / 7.5).
    * Respiratory Disorders: Assess if compensation is acute or chronic based on HCO3 changes.

3.  **"hhAnalysis"**: Provide a Henderson-Hasselbalch based analysis.
    * Calculate the Anion Gap (AG) = (Na+ + K+) - (Cl- + HCO3-). State if it is normal or high.
    * If albumin is provided, calculate the Corrected AG = AG + 0.25 * (40 - albumin).
    * If a HAGMA is present, calculate and interpret the Delta Ratio. If it's uninterpretable (e.g., due to normal HCO3), state this and explain why.

4.  **"stewartAnalysis"**: Perform a detailed quantitative analysis using the Stewart approach.
    * Calculate SIDa (Apparent Strong Ion Difference) = [Na+] + [K+] - [Cl-].
    * Calculate SIDe (Effective Strong Ion Difference). Use the formula: (1000 * 2.46 * 10^-11 * pCO2 / (10^-pH)) + (albumin * (0.123 * pH - 0.631)) + (1 * (0.309 * pH - 0.469)). Assume phosphate is 1 mmol/L if not given.
    * Calculate the Strong Ion Gap (SIG) = SIDa - SIDe.
    * **Provide a full interpretation paragraph**: Explain what the SIG represents clinically. A significantly positive SIG (>2) indicates the presence of unmeasured anions (e.g., ketones, lactate, salicylates, toxins) and is the primary driver of the acidosis. A SIG near zero in the presence of a HAGMA suggests hypoalbuminaemia is a major contributor.

5.  **"additionalCalculations"**:
    * If FiO2 is provided, calculate and interpret the P/F ratio (PaO2 in kPa / FiO2 as a decimal).
    * If albumin is provided, calculate the corrected calcium.

6.  **"differentials"**: Provide a comprehensive, structured list of potential causes for each acid-base abnormality identified. For each major differential, suggest the **"Next critical step:"** (e.g., "Check serum ketones"). The most likely overall diagnosis should be in **bold**.`;

        // First, build the part of the prompt with the patient's data
        let patientDataPrompt = `Clinical History: ${clinicalHistory || 'Not provided'}\n`;
        patientDataPrompt += `Sample Type: ${sampleType || 'Arterial'}\n`;
        patientDataPrompt += `Values:\n`;

        const analysisValues = { ...values };
        if (!analysisValues.albumin || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 42.5; // Assume normal if not provided
        }

        const valueMapping = {
            ph: 'pH', pco2: 'pCO₂ (kPa)', po2: 'pO₂ (kPa)', hco3: 'HCO₃⁻ (mmol/L)',
            sodium: 'Na⁺ (mmol/L)', potassium: 'K⁺ (mmol/L)', chloride: 'Cl⁻ (mmol/L)',
            albumin: 'Albumin (g/L)', lactate: 'Lactate (mmol/L)', glucose: 'Glucose (mmol/L)',
            calcium: 'Ionised Ca²⁺ (mmol/L)', hb: 'Hb (g/L)', fio2: 'FiO₂ (%)'
        };

        for (const [key, label] of Object.entries(valueMapping)) {
            if (analysisValues[key] !== null && analysisValues[key] !== undefined && !isNaN(analysisValues[key])) {
                if (key === 'albumin' && !values.albumin) {
                    patientDataPrompt += `- ${label}: ${analysisValues[key]} (assumed normal)\n`;
                } else {
                    patientDataPrompt += `- ${label}: ${analysisValues[key]}\n`;
                }
            }
        }

        // Now, combine the system instructions and patient data into one prompt
        const combinedPrompt = `${systemPrompt}

---

Based on the rules and instructions above, please analyze the following blood gas:
${patientDataPrompt}`;

        // Create the simplified request payload without the 'systemInstruction' field
        const requestPayload = {
            contents: [{
                parts: [{ text: combinedPrompt }]
            }],
            generationConfig: {
                temperature: 0.2, // Slightly increased for more descriptive text
                topK: 1,
                topP: 0.8,
                maxOutputTokens: 8192 // Increased to allow for more detailed responses
            }
        };

        console.log('Sending request to Gemini API...');
        
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API error:', errorText);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Analysis failed. Please try again.' })
            };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        console.log('Raw response from Gemini:', responseText);
        
        if (!responseText) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'No analysis content returned from AI.' })
            };
        }

        // Extract JSON from response - try multiple approaches
        let extractedJson;
        try {
            // First, try to parse the entire response as JSON
            extractedJson = JSON.parse(responseText.trim());
        } catch (e1) {
            try {
                // Remove any markdown code blocks
                let cleanedText = responseText
                    .replace(/```json\s*/gi, '')
                    .replace(/```\s*/g, '')
                    .trim();
                
                // Try to find JSON object boundaries
                const startIndex = cleanedText.indexOf('{');
                const endIndex = cleanedText.lastIndexOf('}');
                
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    const jsonString = cleanedText.substring(startIndex, endIndex + 1);
                    extractedJson = JSON.parse(jsonString);
                } else {
                    throw new Error('No valid JSON structure found');
                }
            } catch (e2) {
                console.error('Failed to parse JSON:', e2);
                console.error('Response was:', responseText);
                
                // As a last resort, create a structured response from the text
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify({
                        keyFindings: "Analysis completed but formatting error occurred. Please retry.",
                        compensationAnalysis: responseText || "Unable to parse compensation analysis.",
                        hhAnalysis: "Unable to parse Henderson-Hasselbalch analysis.",
                        stewartAnalysis: "Unable to parse Stewart analysis.",
                        additionalCalculations: "Unable to parse additional calculations.",
                        differentials: "Unable to parse differential diagnoses."
                    })
                };
            }
        }
        
        // Ensure all required keys exist with default values if missing
        const requiredKeys = ['keyFindings', 'compensationAnalysis', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
        for (const key of requiredKeys) {
            if (!extractedJson[key] || extractedJson[key] === null || extractedJson[key] === undefined) {
                extractedJson[key] = 'Not performed for this analysis.';
            }
        }

        console.log('Successfully parsed JSON response');

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'  // Prevent caching of medical data
            },
            body: JSON.stringify(extractedJson)
        };

    } catch (error) {
        console.error('Analysis function error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An unexpected error occurred during analysis: ' + error.message })
        };
    }
};

