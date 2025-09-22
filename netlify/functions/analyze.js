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
                body: JSON.stringify({ error: 'API key not configured. Please set GEMINI_API_KEY in Netlify environment variables.' })
            };
        }

        const { values, clinicalHistory, sampleType } = JSON.parse(event.body);

        if (!values || !values.ph || !values.pco2) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'pH and pCO2 values are required for analysis.' })
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

        const systemPrompt = `You are an expert clinical biochemist interpreting blood gas results with emphasis on compensation analysis.

CRITICAL: Your ENTIRE response must be ONLY a valid JSON object, with NO other text before or after.
Do not include markdown formatting, backticks, or any explanatory text.
Start directly with { and end with }

The JSON must have these exact keys: "keyFindings", "compensationAnalysis", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials"

CRITICAL VALUES to flag:
- pH < 7.2 or > 7.6
- pCO2 < 2.0 or > 9.0 kPa
- K+ < 2.5 or > 6.5
- lactate > 4.0

COMPENSATION ANALYSIS REQUIREMENTS:

1. METABOLIC ACIDOSIS:
   - Expected pCO2 = 1.5 × [HCO3] + 8 (±2) - Winter's formula
   - If actual pCO2 > expected: concurrent respiratory acidosis
   - If actual pCO2 < expected: concurrent respiratory alkalosis
   - Include: "Expected pCO2: X kPa, Actual: Y kPa, Compensation: [appropriate/partial/mixed disorder]"

2. METABOLIC ALKALOSIS:
   - Expected pCO2 increase = 0.7 × (HCO3 - 24)
   - Maximum compensation pCO2 ≈ 7.3 kPa (55 mmHg)

3. RESPIRATORY ACIDOSIS:
   - Acute: HCO3 increases 1 mmol/L per 1.33 kPa pCO2 rise
   - Chronic: HCO3 increases 4 mmol/L per 1.33 kPa pCO2 rise

4. RESPIRATORY ALKALOSIS:
   - Acute: HCO3 falls 2 mmol/L per 1.33 kPa pCO2 fall
   - Chronic: HCO3 falls 4 mmol/L per 1.33 kPa pCO2 fall

5. MIXED DISORDERS:
   - Calculate Delta Ratio = (AG - 12) / (24 - HCO3)
   - Interpret: <0.4 hyperchloremic, 0.4-0.8 mixed, 0.8-2.0 pure high AG, >2.0 metabolic alkalosis + high AG

FORMAT each key as follows:

"keyFindings": String with primary disorder, compensation status, critical values, and top 3 differentials. Use **bold** for critical values.

"compensationAnalysis": String with detailed compensation calculations showing expected vs actual values with interpretation.

"hhAnalysis": String with Henderson-Hasselbalch analysis including Anion Gap (use albumin 42.5 g/L if not provided), corrected AG, and base excess. **Bold** abnormal values.

"stewartAnalysis": String with Stewart analysis if electrolytes available. Calculate SIDa, SIDe, SIG. Note if albumin assumed.

"additionalCalculations": String with P/F ratio if FiO2 provided, A-a gradient if room air, corrected calcium if applicable.

"differentials": String with comprehensive differential list. **Bold** the most likely diagnosis.`;

        // Build the analysis prompt
        let prompt = `Analyze this blood gas:\n`;
        prompt += `Clinical History: ${clinicalHistory || 'Not provided'}\n`;
        prompt += `Sample Type: ${sampleType || 'Arterial'}\n`;
        prompt += `Values:\n`;
        
        // Format values for analysis - assume normal albumin if not provided
        const analysisValues = { ...values };
        if (!analysisValues.albumin || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 42.5; // Mid-range normal (35-50 g/L range)
        }
        
        const valueMapping = {
            ph: 'pH',
            pco2: 'pCO₂ (kPa)',
            po2: 'pO₂ (kPa)',
            hco3: 'HCO₃⁻ (mmol/L)',
            sodium: 'Na⁺ (mmol/L)',
            potassium: 'K⁺ (mmol/L)',
            chloride: 'Cl⁻ (mmol/L)',
            albumin: 'Albumin (g/L)',
            lactate: 'Lactate (mmol/L)',
            glucose: 'Glucose (mmol/L)',
            calcium: 'Ionised Ca²⁺ (mmol/L)',
            hb: 'Hb (g/L)',
            fio2: 'FiO₂ (%)'
        };

        for (const [key, label] of Object.entries(valueMapping)) {
            if (analysisValues[key] !== null && analysisValues[key] !== undefined && !isNaN(analysisValues[key])) {
                if (key === 'albumin' && !values.albumin) {
                    prompt += `- ${label}: ${analysisValues[key]} (assumed normal)\n`;
                } else {
                    prompt += `- ${label}: ${analysisValues[key]}\n`;
                }
            }
        }

        prompt += `\nIMPORTANT: Calculate and show the expected compensation for the primary disorder. Compare actual vs expected values explicitly.`;
        prompt += `\nREMEMBER: Return ONLY a JSON object with no markdown formatting or extra text.`;

        const requestPayload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.1,  // Very low temperature for consistent formatting
                topK: 1,
                topP: 0.8,
                maxOutputTokens: 4096
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
