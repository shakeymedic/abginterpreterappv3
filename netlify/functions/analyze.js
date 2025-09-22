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
Your entire response MUST be ONLY a single, valid JSON object. Do not include markdown, comments, or any other text.
The JSON must have these exact keys: "keyFindings", "compensationAnalysis", "hhAnalysis", "stewartAnalysis", "additionalCalculations", "differentials".

**RULES FOR JSON VALUES:**
**1. FINAL VALUES ONLY: All numerical values in the JSON MUST be the final, calculated number. DO NOT include mathematical expressions (e.g., "126 + 2.93 - 86.6"). Provide only the result (e.g., 42.33).**
**2. ALL STRINGS MUST BE QUOTED: Every string value must be enclosed in double quotes.**

CRITICAL VALUES:
Flag if pH < 7.2 or > 7.6, pCO2 < 2.0 or > 9.0 kPa, K+ < 2.5 or > 6.5, lactate > 4.0

COMPENSATION ANALYSIS REQUIREMENTS:
You MUST calculate and report expected compensation for all acid-base disorders...
// ... (the rest of your prompt remains the same) ...

"differentials":
- Comprehensive list based on pattern
- **Bold** most likely diagnosis
- Include emergency conditions

**Your final output must start with { and end with } and contain nothing else.**`;

1. METABOLIC ACIDOSIS:
   - Expected pCO2 = 1.5 × [HCO3] + 8 (±2) - Winter's formula
   - If actual pCO2 > expected: concurrent respiratory acidosis
   - If actual pCO2 < expected: concurrent respiratory alkalosis
   - Report: "Expected pCO2: X kPa, Actual: Y kPa, Compensation: [appropriate/mixed disorder]"

2. METABOLIC ALKALOSIS:
   - Expected pCO2 increase = 0.7 × (HCO3 - 24)
   - Maximum compensation pCO2 ≈ 7.3 kPa (55 mmHg)
   - Report expected vs actual and adequacy

3. RESPIRATORY ACIDOSIS:
   - Acute: HCO3 increases 1 mmol/L per 10 mmHg (1.33 kPa) pCO2 rise
   - Chronic: HCO3 increases 4 mmol/L per 10 mmHg (1.33 kPa) pCO2 rise
   - Calculate both and determine if acute, chronic, or acute-on-chronic

4. RESPIRATORY ALKALOSIS:
   - Acute: HCO3 falls 2 mmol/L per 10 mmHg (1.33 kPa) pCO2 fall
   - Chronic: HCO3 falls 4 mmol/L per 10 mmHg (1.33 kPa) pCO2 fall
   - Determine acute vs chronic based on compensation

5. MIXED DISORDERS:
   - Delta Ratio = (AG - 12) / (24 - HCO3)
   - If < 0.4: hyperchloremic acidosis
   - If 0.4-0.8: mixed high + normal AG acidosis
   - If 0.8-2.0: pure high AG acidosis
   - If > 2.0: metabolic alkalosis + high AG acidosis

FORMAT YOUR RESPONSE:

"keyFindings": 
- Primary disorder with severity
- Compensation status (full/partial/none/mixed)
- Critical values requiring urgent attention
- Top 3 differential diagnoses

"compensationAnalysis":
- Primary disorder identified
- Expected compensation calculation shown step-by-step
- Actual vs expected values
- Interpretation (appropriate compensation / mixed disorder)
- If respiratory: acute vs chronic assessment
- Delta ratio if metabolic acidosis with AG

"hhAnalysis":
- Full Henderson-Hasselbalch analysis
- Anion Gap with correction for albumin (use 42.5 g/L if not provided)
- Corrected AG = AG + 2.5 × (40 - albumin)/10
- Base excess calculation
- **Bold** abnormal values with UK ranges

"stewartAnalysis":
- Calculate even if albumin not explicitly provided (use assumed 42.5 g/L)
- If Na, K, Cl available: perform full Stewart analysis
- SIDa, SIDe, SIG calculations
- Note if albumin was assumed vs provided
- Independent effects assessment

"additionalCalculations":
- P/F ratio if FiO2 provided (interpret: >40 normal, 27-40 mild, 13-27 moderate, <13 severe)
- A-a gradient if on room air
- Corrected calcium = measured Ca + 0.02 × (40 - albumin), using assumed albumin if needed

"differentials":
- Comprehensive list based on pattern
- **Bold** most likely diagnosis
- Include emergency conditions`;

        // Build the analysis prompt
        let prompt = `Analyze this blood gas with detailed compensation assessment:\n`;
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

        // Add specific instruction for compensation
        prompt += `\nIMPORTANT: Calculate and show the expected compensation for the primary disorder. Compare actual vs expected values explicitly.`;

        const requestPayload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.2,  // Lower temperature for more consistent calculations
                topK: 1,
                topP: 0.95,
                maxOutputTokens: 4096
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
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Analysis failed. Please try again.' })
            };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'No analysis content returned.' })
            };
        }

        // Extract JSON from response
        let extractedJson;
        try {
            const startIndex = responseText.indexOf('{');
            const endIndex = responseText.lastIndexOf('}');
            
            if (startIndex === -1 || endIndex === -1) {
                throw new Error('No JSON found in response');
            }
            
            const jsonString = responseText.substring(startIndex, endIndex + 1);
            extractedJson = JSON.parse(jsonString);
            
            // Ensure all required keys exist
            const requiredKeys = ['keyFindings', 'compensationAnalysis', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
            for (const key of requiredKeys) {
                if (!extractedJson[key]) {
                    extractedJson[key] = 'Analysis not performed.';
                }
            }
        } catch (parseError) {
            console.error('JSON parsing error:', parseError, 'Response:', responseText);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to parse analysis results.' })
            };
        }

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
            body: JSON.stringify({ error: 'An unexpected error occurred during analysis.' })
        };
    }
};
