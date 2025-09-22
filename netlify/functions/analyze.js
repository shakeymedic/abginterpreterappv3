exports.handler = async (event) => {
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

        // Use Gemini 2.5 Flash
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are a consultant clinical biochemist providing expert blood gas interpretation.

CRITICAL: Return ONLY a valid JSON object. No markdown, no explanatory text.
Start with { and end with }

Required JSON structure:
{
  "keyFindings": "string",
  "compensationAnalysis": "string", 
  "hhAnalysis": "string",
  "stewartAnalysis": "string",
  "additionalCalculations": "string",
  "differentials": "string"
}

DETAILED ANALYSIS REQUIREMENTS:

"keyFindings": Write a comprehensive paragraph:
- Open with "This patient presents with [disorder description]"
- State if simple, mixed, or complex disorder
- If mixed: "comprising a [disorder 1] and a concurrent [disorder 2]"
- Note critical values (pH <7.2 or >7.6, K+ <2.5 or >6.5, lactate >4)
- Comment on compensation adequacy
- Note lactate levels
- Conclude with likely contributors based on history

"compensationAnalysis": Must include:
- "This is a [type] disorder: [description]"
- List evidence for each disorder component
- For metabolic acidosis, calculate Winter's formula:
  "Expected pCO2 = 1.5 × [HCO3] + 8 ± 2 = [calculation] mmHg"
  Compare to actual pCO2
- For respiratory disorders, assess acute vs chronic:
  Acute respiratory acidosis: HCO3 rises 1 per 1.33 kPa pCO2 increase
  Chronic: HCO3 rises 4 per 1.33 kPa pCO2 increase
- State compensation adequacy clearly

"hhAnalysis": Format as:
"Henderson-Hasselbalch Analysis
pH: [value] (7.35-7.45) - [Status]
pCO2: [value] mmHg ([kPa] kPa or 35-45 mmHg) - [Interpretation]
HCO3-: [value] mmol/L (22-26 mmol/L) - [Interpretation]
${values.be !== null && values.be !== undefined ? "Base Excess: [value] mmol/L (-2 to +2 mmol/L) - [Interpretation]" : ""}

Calculated Values:
Anion Gap (AG) = [Na+] - ([Cl-] + [HCO3-]) = [calculation] = [result] (8-12 mmol/L)
Albumin-corrected AG: [If albumin provided] = AG + 2.5 × (40 - albumin)/10 = [result]
[Or state: Using assumed albumin of 42.5 g/L]
Delta Ratio = (AG - 12) / (24 - HCO3) = [calculation] = [result]
Interpretation: [<0.4 hyperchloremic, 0.4-0.8 mixed, 0.8-2.0 pure high AG, >2.0 with metabolic alkalosis]"

"stewartAnalysis": Format as:
"Stewart (Physicochemical) Analysis
Strong Ion Difference Apparent (SIDa) = ([Na+] + [K+]) - [Cl-] = [calculation] = [result] mmol/L (38-44)
[If albumin available: Calculate SIDe and SIG]
[If not: State albumin assumed at 42.5 g/L for calculations]"

"additionalCalculations":
Include P/F ratio if FiO2 provided
A-a gradient if on room air
State if venous sample limits oxygenation assessment

"differentials": Categorized list:
"Potential Differential Diagnoses

[Primary disorder category]:
• **[Most likely]** - [Details]
• [Other causes with clinical correlation]

[Secondary disorders if present]"

Use UK reference ranges. Bold critical values with **text**.
Show ALL calculations step by step.`;

        // Build the analysis request
        const analysisValues = { ...values };
        
        // Assume normal albumin if not provided
        if (!analysisValues.albumin || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 42.5;
        }

        // Convert to mmHg for display
        const pco2_mmHg = (analysisValues.pco2 * 7.5).toFixed(1);
        const po2_mmHg = analysisValues.po2 ? (analysisValues.po2 * 7.5).toFixed(1) : null;
        
        let prompt = `Analyze this blood gas comprehensively:

Clinical History: ${clinicalHistory || 'Not provided'}
Sample Type: ${sampleType || 'Arterial'}

Values:
• pH: ${analysisValues.ph}
• pCO2: ${analysisValues.pco2} kPa (${pco2_mmHg} mmHg)`;

        if (analysisValues.po2 !== null && analysisValues.po2 !== undefined) {
            prompt += `\n• pO2: ${analysisValues.po2} kPa (${po2_mmHg} mmHg)`;
        }
        if (analysisValues.hco3 !== null && analysisValues.hco3 !== undefined) {
            prompt += `\n• HCO3-: ${analysisValues.hco3} mmol/L`;
        }
        if (analysisValues.be !== null && analysisValues.be !== undefined) {
            prompt += `\n• Base Excess: ${analysisValues.be} mmol/L`;
        }
        if (analysisValues.sodium !== null && analysisValues.sodium !== undefined) {
            prompt += `\n• Na+: ${analysisValues.sodium} mmol/L`;
        }
        if (analysisValues.potassium !== null && analysisValues.potassium !== undefined) {
            prompt += `\n• K+: ${analysisValues.potassium} mmol/L`;
        }
        if (analysisValues.chloride !== null && analysisValues.chloride !== undefined) {
            prompt += `\n• Cl-: ${analysisValues.chloride} mmol/L`;
        }
        
        const albumin_note = values.albumin ? '' : ' (assumed normal)';
        prompt += `\n• Albumin: ${analysisValues.albumin} g/L${albumin_note}`;
        
        if (analysisValues.lactate !== null && analysisValues.lactate !== undefined) {
            prompt += `\n• Lactate: ${analysisValues.lactate} mmol/L`;
        }
        if (analysisValues.glucose !== null && analysisValues.glucose !== undefined) {
            prompt += `\n• Glucose: ${analysisValues.glucose} mmol/L`;
        }
        if (analysisValues.calcium !== null && analysisValues.calcium !== undefined) {
            prompt += `\n• Ionised Calcium: ${analysisValues.calcium} mmol/L`;
        }
        if (analysisValues.hb !== null && analysisValues.hb !== undefined) {
            prompt += `\n• Hemoglobin: ${analysisValues.hb} g/L`;
        }
        if (analysisValues.fio2 !== null && analysisValues.fio2 !== undefined) {
            prompt += `\n• FiO2: ${analysisValues.fio2}%`;
        }

        prompt += `\n\nProvide detailed clinical interpretation with all calculations shown.
Return ONLY the JSON object.`;

        const requestPayload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.25,
                topK: 2,
                topP: 0.95,
                maxOutputTokens: 6000,
                candidateCount: 1
            }
        };

        console.log(`[${new Date().toISOString()}] Sending to Gemini 2.5 Flash for analysis`);
        
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error(`Gemini API error (${geminiResponse.status}):`, errorText);
            
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
            console.error('Empty response from Gemini');
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ 
                    error: 'No analysis generated. Please try again.'
                })
            };
        }

        // Parse JSON response
        let extractedJson;
        
        try {
            extractedJson = JSON.parse(responseText.trim());
            console.log('Successfully parsed JSON on first attempt');
        } catch (e1) {
            console.log('First parse failed, attempting cleanup');
            
            try {
                let cleaned = responseText;
                
                // Remove markdown
                cleaned = cleaned.replace(/```json\s*/gi, '');
                cleaned = cleaned.replace(/```\s*/g, '');
                
                // Extract JSON
                const firstBrace = cleaned.indexOf('{');
                const lastBrace = cleaned.lastIndexOf('}');
                
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                }
                
                extractedJson = JSON.parse(cleaned);
                console.log('Successfully parsed after cleanup');
                
            } catch (e2) {
                console.error('JSON parsing failed:', e2);
                
                // Fallback response
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        keyFindings: `Analysis completed. pH ${values.ph}, pCO2 ${values.pco2} kPa. ${values.ph < 7.35 ? "Acidemia present." : values.ph > 7.45 ? "Alkalemia present." : "Normal pH."} Please retry for detailed analysis.`,
                        compensationAnalysis: "Detailed compensation analysis pending. Please retry.",
                        hhAnalysis: `pH: ${values.ph}\npCO2: ${values.pco2} kPa\n${values.hco3 ? `HCO3: ${values.hco3} mmol/L` : ''}\n${values.be ? `Base Excess: ${values.be} mmol/L` : ''}`,
                        stewartAnalysis: "Stewart analysis pending. Please retry.",
                        additionalCalculations: "Additional calculations pending. Please retry.",
                        differentials: "Differential diagnoses pending. Please retry."
                    })
                };
            }
        }
        
        // Validate required keys
        const requiredKeys = ['keyFindings', 'compensationAnalysis', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
        
        for (const key of requiredKeys) {
            if (!extractedJson[key] || typeof extractedJson[key] !== 'string' || extractedJson[key].length < 20) {
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
