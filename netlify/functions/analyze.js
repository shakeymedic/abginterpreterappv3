exports.handler = async (event) => {
    // Security headers
    const headers = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    };

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const startTime = Date.now();

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY not configured');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Configuration error. Please contact support.'
                })
            };
        }

        const { values, clinicalHistory, sampleType } = JSON.parse(event.body);

        if (!values || typeof values.ph !== 'number' || typeof values.pco2 !== 'number') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid input. pH and pCO₂ are required.'
                })
            };
        }

        // Use Gemini 2.5 Flash - the latest model with thinking capabilities
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // This prompt is specifically designed to leverage Gemini 2.5 Flash's thinking capabilities
        const systemPrompt = `You are a consultant clinical biochemist and intensivist providing expert blood gas interpretation.

CRITICAL INSTRUCTION: Return ONLY a valid JSON object. No markdown, no code blocks, no explanatory text.
Start directly with { and end with }

The JSON must have exactly these keys:
{
  "keyFindings": "detailed paragraph",
  "compensationAnalysis": "detailed paragraph", 
  "hhAnalysis": "detailed paragraph",
  "stewartAnalysis": "detailed paragraph",
  "additionalCalculations": "detailed paragraph",
  "differentials": "detailed list"
}

DETAILED REQUIREMENTS:

For "keyFindings":
Write a comprehensive clinical summary paragraph that:
1. Opens with: "This patient presents with [primary disorder description]"
2. Describes whether it's a simple, mixed, or complex acid-base disorder
3. If mixed, state: "comprising a [disorder 1] and a concurrent [disorder 2]"
4. Mentions any critical values (pH <7.2 or >7.6, K+ <2.5 or >6.5, lactate >4)
5. Comments on compensation: "There is [also/mild/no] [metabolic/respiratory] compensation"
6. Notes lactate if elevated: "and a [normal/elevated] lactate"
7. Concludes with: "Given the history of [context], [condition] is a strong contributor to the [disorder type]"
8. States: "The [metabolic/respiratory] acidosis/alkalosis suggests [pathophysiology], which could be due to [cause 1] or [cause 2]"

For "compensationAnalysis":
MUST include these exact analyses:
1. Open with: "This is a [mixed/simple] acid-base disorder: [specific description]"
2. List: "Evidence for [Disorder Type]:" followed by bullet points of evidence
3. For metabolic acidosis, ALWAYS calculate Winter's formula:
   "Evidence for Respiratory Acidosis: The elevated pCO2 ([value] mmHg) is pushing the pH down. If this were an acute respiratory acidosis alone, the expected HCO3 would be approximately [24 + (pCO2-40)/10] ± 2 mmol/L. The observed HCO3 of [value] mmol/L is [lower/higher] than expected, confirming a co-existing metabolic acidosis."
4. Show: "Evidence for Metabolic Acidosis: The elevated Anion Gap (see below) confirms the presence of a metabolic acidosis. If this were a primary metabolic acidosis, the expected compensatory pCO2 (Winter's formula) would be [1.5 × HCO3 + 8 ± 2] = [calculated range] mmHg. The observed pCO2 of [value] mmHg is significantly higher than expected, confirming a co-existing respiratory acidosis."

For "hhAnalysis":
Format EXACTLY as:
"Henderson-Hasselbalch Analysis
pH: [value] (7.35-7.45) - [Interpretation]
pCO2: [value] mmHg ([kPa value] kPa or 35-45 mmHg) - Elevated, indicating a respiratory acidosis component.
HCO3-: [value] mmol/L (22-26 mmol/L) - Within the normal reference range, but relatively low considering the elevated pCO2 and a high anion gap, suggesting it's being consumed by metabolic acidosis.

Calculated Values:
Anion Gap (AG) = [Na+] - ([Cl-] + [HCO3-]) = [show calculation] = [result] mmol/L (8-12 mmol/L) - This is elevated, indicating a high anion gap metabolic acidosis.
Albumin-corrected AG: Cannot be calculated as albumin concentration is not provided. [OR if albumin provided/assumed: = [calculation]]
Delta Ratio = (AG - 12) / (24 - HCO3-) = [show calculation] = [result]
[Interpret delta ratio: <0.4 = hyperchloremic acidosis, 0.4-0.8 = mixed, 0.8-2.0 = pure high AG, >2.0 = metabolic alkalosis + high AG]"

For "stewartAnalysis":
Format as:
"Stewart (Physicochemical) Analysis
Strong Ion Difference Apparent (SIDa) = ([Na+] + [K+]) - [Cl-] = [show calculation] = [result] mmol/L (38-44 mmol/L) - This value is [interpretation].
Strong Ion Difference Effective (SIDe): Cannot be calculated as albumin concentration is not provided. The formula requires albumin to estimate the unmeasured anions.
Strong Ion Gap (SIG) = SIDa - SIDe: Cannot be calculated without albumin concentration.
[If albumin assumed/provided, show all calculations]"

For "additionalCalculations":
Include:
"Additional Calculations
PaO2/FiO2 (P/F) Ratio: [If venous: 'This calculation cannot be performed as the sample provided is venous blood (not arterial), and therefore the pO2 value is not representative of arterial oxygenation.'] [If arterial with FiO2: show calculation and interpretation]
[If arterial] Additionally, ARDS severity assessment requires an arterial blood gas."

For "differentials":
Format as categorized list:
"Potential Differential Diagnoses

[Primary Category - e.g., High Anion Gap Metabolic Acidosis]:
• **[Most likely diagnosis]** ([Acronym if applicable]): [Clinical details, e.g., 'Glucose is elevated (X mmol/L), but not typically in the DKA range. Next critical step: Check serum or urine ketones']
• [Second diagnosis]: [Details including relevant lab values and clinical correlation]
• [Continue with all relevant differentials in this category]

[Secondary Category - e.g., Respiratory Acidosis]:
• [List causes: Central/Neuromuscular/Airway/Lung Disease]
• [Specific conditions with clinical context]

[If Mixed Disorder]:
• [Explain the specific combination and likely clinical scenarios]"

Remember:
- Use UK reference ranges
- Bold critical values using **text**
- Show ALL calculations step by step
- Use medical terminology appropriately
- If albumin not provided, assume 42.5 g/L and note it`;

        // Build the request with optimal formatting for Gemini 2.5 Flash
        const analysisValues = { ...values };
        
        // Always assume albumin if not provided
        if (!analysisValues.albumin || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 42.5;
        }

        // Pre-calculate some values to help the model
        const pco2_mmHg = (analysisValues.pco2 * 7.5).toFixed(1);
        const po2_mmHg = analysisValues.po2 ? (analysisValues.po2 * 7.5).toFixed(1) : null;
        
        // Build a structured prompt that Gemini 2.5 Flash will understand clearly
        let prompt = `Perform a comprehensive blood gas analysis with detailed clinical interpretation.

Clinical Context: ${clinicalHistory || 'No specific history provided'}
Sample Type: ${sampleType || 'Arterial'}

Laboratory Values:
• pH: ${analysisValues.ph}
• pCO2: ${analysisValues.pco2} kPa (${pco2_mmHg} mmHg)
${analysisValues.po2 !== null ? `• pO2: ${analysisValues.po2} kPa (${po2_mmHg} mmHg)` : ''}
${analysisValues.hco3 !== null ? `• HCO3-: ${analysisValues.hco3} mmol/L` : ''}
${analysisValues.sodium !== null ? `• Na+: ${analysisValues.sodium} mmol/L` : ''}
${analysisValues.potassium !== null ? `• K+: ${analysisValues.potassium} mmol/L` : ''}
${analysisValues.chloride !== null ? `• Cl-: ${analysisValues.chloride} mmol/L` : ''}
• Albumin: ${analysisValues.albumin} g/L${values.albumin ? '' : ' (assumed normal)'}
${analysisValues.lactate !== null ? `• Lactate: ${analysisValues.lactate} mmol/L` : ''}
${analysisValues.glucose !== null ? `• Glucose: ${analysisValues.glucose} mmol/L` : ''}
${analysisValues.calcium !== null ? `• Ionised Calcium: ${analysisValues.calcium} mmol/L` : ''}
${analysisValues.hb !== null ? `• Hemoglobin: ${analysisValues.hb} g/L` : ''}
${analysisValues.fio2 !== null ? `• FiO2: ${analysisValues.fio2}%` : ''}

Provide a detailed interpretation following the exact format specified. Show ALL calculations with actual numbers.
Remember to return ONLY the JSON object, no other text.`;

        const requestPayload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.25,  // Optimal for Gemini 2.5 Flash's thinking mode
                topK: 2,           // Allows controlled variation
                topP: 0.95,        // Good for clinical language
                maxOutputTokens: 6000,  // Plenty of room for detailed analysis
                candidateCount: 1
            }
        };

        console.log(`[${new Date().toISOString()}] Sending to Gemini 2.5 Flash API with thinking mode`);
        
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error(`Gemini API error (${geminiResponse.status}):`, errorText);
            
            // Check for specific error types
            if (geminiResponse.status === 429) {
                return {
                    statusCode: 429,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Rate limit reached. Please wait a moment and try again.'
                    })
                };
            }
            
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ 
                    error: 'Analysis service temporarily unavailable. Please try again.'
                })
            };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            console.error('Empty response from Gemini 2.5 Flash');
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ 
                    error: 'No analysis generated. Please try again.'
                })
            };
        }

        // Enhanced JSON extraction for Gemini 2.5 Flash responses
        let extractedJson;
        
        try {
            // First attempt: direct parse (ideal case)
            extractedJson = JSON.parse(responseText.trim());
            console.log('Successfully parsed JSON on first attempt');
        } catch (e1) {
            console.log('First parse attempt failed, trying cleanup strategies');
            
            try {
                // Second attempt: remove any markdown or extra text
                let cleaned = responseText;
                
                // Remove markdown code blocks
                cleaned = cleaned.replace(/```json\s*/gi, '');
                cleaned = cleaned.replace(/```\s*/g, '');
                
                // Remove any text before first { and after last }
                const firstBrace = cleaned.indexOf('{');
                const lastBrace = cleaned.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                }
                
                // Remove any non-JSON characters that might have slipped in
                cleaned = cleaned.replace(/[\u0000-\u001F]+/g, ''); // Remove control characters
                
                // Try parsing the cleaned version
                extractedJson = JSON.parse(cleaned);
                console.log('Successfully parsed JSON after cleanup');
                
            } catch (e2) {
                console.error('JSON parsing failed after cleanup:', e2);
                console.error('Raw response (first 1000 chars):', responseText.substring(0, 1000));
                
                // Final fallback: return a structured error that still shows some analysis
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        keyFindings: "Analysis completed but formatting error occurred. The blood gas shows: " +
                                    `pH ${values.ph} with pCO2 ${values.pco2} kPa. ` +
                                    (values.ph < 7.35 ? "This indicates acidemia. " : values.ph > 7.45 ? "This indicates alkalemia. " : "pH is within normal range. ") +
                                    "Please retry for detailed analysis.",
                        compensationAnalysis: "Detailed compensation analysis unavailable due to formatting error. Please retry.",
                        hhAnalysis: `Henderson-Hasselbalch Analysis\npH: ${values.ph}\npCO2: ${values.pco2} kPa (${pco2_mmHg} mmHg)\n` +
                                   (values.hco3 ? `HCO3: ${values.hco3} mmol/L\n` : '') +
                                   "Complete analysis unavailable - please retry.",
                        stewartAnalysis: "Stewart analysis unavailable due to formatting error. Please retry.",
                        additionalCalculations: "Additional calculations unavailable. Please retry.",
                        differentials: "Differential diagnoses unavailable. Please retry for comprehensive list."
                    })
                };
            }
        }
        
        // Validate that we have all required keys with substantial content
        const requiredKeys = ['keyFindings', 'compensationAnalysis', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
        
        for (const key of requiredKeys) {
            if (!extractedJson[key] || typeof extractedJson[key] !== 'string' || extractedJson[key].length < 20) {
                console.warn(`Key '${key}' is missing or too short, adding placeholder`);
                extractedJson[key] = `${key} analysis pending - please retry if this persists.`;
            }
        }

        const executionTime = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] Analysis completed in ${executionTime}ms`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(extractedJson)
        };

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Function error:`, error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'An error occurred during analysis. Please try again.',
                details: error.message
            })
        };
    }
};
