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

        // Use Gemini 2.5 Flash (v1beta endpoint)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // ENHANCED SYSTEM PROMPT - Matching clinical detail level
        const systemPrompt = `You are a consultant clinical biochemist providing comprehensive blood gas interpretation.

CRITICAL OUTPUT REQUIREMENTS:
- Return ONLY a valid JSON object
- NO markdown formatting, NO code blocks, NO explanatory text outside JSON
- Start response with { and end with }
- Provide extremely detailed clinical analysis matching consultant-level depth

REQUIRED JSON STRUCTURE (ALL keys mandatory):
{
  "keyFindings": "string (400-600 words)",
  "compensationAnalysis": "string (350-500 words)", 
  "hhAnalysis": "string (detailed structured format)",
  "stewartAnalysis": "string (detailed structured format)",
  "additionalCalculations": "string (250-400 words)",
  "differentials": "string (400-600 words)"
}

SECTION SPECIFICATIONS:

"keyFindings": 
- Start: "This patient presents with [specific detailed disorder description]"
- Provide comprehensive pathophysiological explanation of the disorder
- Discuss clinical severity and immediate risk stratification
- Integrate all abnormal values with detailed clinical significance
- Include compensation mechanisms and their physiological basis
- Correlate findings with clinical history and presentation
- Discuss potential complications and monitoring requirements
- Address any diagnostic uncertainties or conflicting findings
- Include prognostic indicators and timeframe considerations
- Mention any critical interventions that may be needed urgently
- Word count: 400-600 words

"compensationAnalysis":
- Provide detailed assessment of primary vs secondary disorders with mechanistic explanations
- Include comprehensive calculation explanations with physiological rationale:
  * For metabolic acidosis: Full Winter's formula with expected timeframes and limitations
  * For respiratory disorders: Acute vs chronic compensation with cellular mechanisms
  * Mixed disorders: Evidence for each component with quantitative analysis
- Explain the detailed physiological basis for compensation mechanisms
- Assess adequacy, timing, and sustainability of compensation responses
- Discuss respiratory muscle fatigue risk and ventilatory limitations
- Include renal compensation assessment where applicable
- Address any compensation failures or inappropriate responses
- Provide clinical implications of compensation patterns
- Word count: 350-500 words

"hhAnalysis":
Use this comprehensive format:
"Henderson-Hasselbalch Analysis
pH: [value] (7.35-7.45) - [Detailed status with severity and clinical implications]
pCO2: [value] kPa ([mmHg] mmHg) (4.7-6.0 kPa or 35-45 mmHg) - [Detailed interpretation with physiological context]
HCO3-: [value] mmol/L (22-26 mmol/L) - [Detailed status with metabolic implications]
Base Excess: [value] mmol/L (-2 to +2 mmol/L) - [Detailed interpretation with buffer system analysis]

Primary Disorder Assessment:
[Comprehensive analysis of primary disorder with mechanistic explanation]
[Detailed discussion of acid-base chemistry and buffer systems involved]

Compensation Mechanisms:
[Detailed respiratory compensation assessment with physiological rationale]
[Renal compensation discussion where applicable]

Mathematical Verification:
[pH calculation verification using Henderson-Hasselbalch equation]
[Discussion of any discrepancies and their clinical significance]

Calculated Values:
Anion Gap (AG) = [Na+] - ([Cl-] + [HCO3-]) = [full calculation] = [result] mmol/L (8-12 mmol/L) - [Detailed interpretation]
Albumin-corrected AG: [Detailed calculation with albumin effect explanation] = [result] mmol/L - [Clinical significance]
Delta Ratio = (AG - 12) / (24 - HCO3) = [full calculation] = [result]
Delta Ratio Clinical Interpretation: [Comprehensive explanation of mixed disorders and diagnostic implications]

Buffer System Analysis:
[Discussion of bicarbonate, phosphate, protein, and hemoglobin buffer contributions]"

"stewartAnalysis":
Use this comprehensive format:
"Stewart Physicochemical Analysis
Strong Ion Difference Apparent (SIDa) = ([Na+] + [K+] + [Ca2+] + [Mg2+]) - ([Cl-] + [lactate] + [other measured anions]) = [full calculation] = [result] mmol/L (38-44 mmol/L)
Strong Ion Difference Effective (SIDe) = [HCO3-] + [albumin effect] + [phosphate effect] + [other weak acids] = [detailed calculation] = [result] mmol/L
Strong Ion Gap (SIG) = SIDa - SIDe = [calculation] = [result] mmol/L (normal 0±2)

Mechanistic Interpretation:
[Detailed explanation of each Stewart parameter and its physiological basis]
[Discussion of independent variables: SID, Atot (weak acids), and pCO2]
[Analysis of dependent variables: pH, HCO3-, and their regulation]

Clinical Correlation:
[How Stewart analysis explains the acid-base disorder mechanistically]
[Comparison with traditional Henderson-Hasselbalch approach]
[Identification of primary pathophysiological processes]

Quantitative Assessment:
[Detailed breakdown of unmeasured anions contributing to SIG]
[Analysis of albumin and phosphate effects on acid-base balance]
[Discussion of therapeutic implications based on Stewart parameters]"

"additionalCalculations":
- Include comprehensive calculation suite based on available data:
  * P/F ratio calculations with detailed oxygenation assessment and ARDS criteria
  * A-a gradient calculations with age-adjusted normal values and clinical interpretation
  * Osmolar gap calculations with detailed toxic alcohol screening implications
  * Corrected calcium calculations if ionized calcium not available
  * Bicarbonate deficit calculations for therapeutic planning
  * Expected compensation calculations with timeframe analysis
- Provide detailed clinical interpretation for each calculation
- Discuss limitations and confounding factors for each parameter
- Include monitoring recommendations and serial measurement importance
- Address sample type limitations (arterial vs venous) with specific implications
- Clinical significance assessment for each calculated parameter
- Integration with overall clinical picture and diagnostic workup
- Therapeutic implications and target value discussions
- Word count: 250-400 words

"differentials":
Provide consultant-level differential diagnosis with detailed clinical reasoning:
"Differential Diagnoses

PRIMARY ACID-BASE DISORDER:
• **Most Likely: [primary diagnosis]** - [Comprehensive clinical correlation with supporting evidence, pathophysiology, and expected laboratory pattern]
• **Alternative 1: [diagnosis]** - [Detailed analysis of supporting vs refuting evidence with clinical reasoning]
• **Alternative 2: [diagnosis]** - [Thorough discussion of clinical context and diagnostic features]
• **Additional consideration: [diagnosis]** - [Clinical pearls and distinguishing features]

UNDERLYING PATHOPHYSIOLOGICAL MECHANISMS:
• [Mechanism 1] - [Detailed explanation of how this leads to observed pattern]
• [Mechanism 2] - [Clinical evidence and expected associated findings]

CONTRIBUTING FACTORS AND COMPLICATIONS:
• [Factor 1] - [How this modifies the clinical picture and prognosis]
• [Factor 2] - [Therapeutic implications and monitoring requirements]

IMMEDIATE CLINICAL PRIORITIES:
• [Priority 1] - [Specific actions required with timeframe]
• [Priority 2] - [Monitoring parameters and frequency]

DIAGNOSTIC WORKUP RECOMMENDATIONS:
• [Investigation 1] - [Clinical rationale and expected findings]
• [Investigation 2] - [Diagnostic yield and therapeutic implications]

PROGNOSTIC INDICATORS:
• [Indicator 1] - [Clinical significance and outcome correlation]
• [Indicator 2] - [Risk stratification and monitoring needs]"
Word count: 400-600 words

CLINICAL DEPTH REQUIREMENTS:
- Provide senior consultant-level clinical reasoning throughout all sections
- Include detailed pathophysiological explanations with mechanistic insights
- Show ALL mathematical calculations step by step with clinical rationale
- Correlate every finding with clinical context and therapeutic implications
- Use **bold** for all abnormal values with severity grading
- Include comprehensive severity assessments with prognostic indicators
- Mention specific timeframes for monitoring and reassessment
- Provide actionable clinical insights with immediate and long-term management
- Use UK/European reference ranges with age-appropriate considerations
- Consider emergency vs routine scenarios with appropriate urgency indicators
- Include clinical pearls and consultant-level insights throughout
- Address diagnostic uncertainties with appropriate hedging and alternative considerations`;

        // Build the analysis request with better structure
        const analysisValues = { ...values };
        
        // Assume normal albumin if not provided
        if (!analysisValues.albumin || isNaN(analysisValues.albumin)) {
            analysisValues.albumin = 40;
        }

        // Convert units and build structured prompt
        const pco2_mmHg = (analysisValues.pco2 * 7.5).toFixed(1);
        const po2_mmHg = analysisValues.po2 ? (analysisValues.po2 * 7.5).toFixed(1) : null;
        
        let prompt = `BLOOD GAS ANALYSIS REQUEST

CLINICAL CONTEXT:
History: ${clinicalHistory || 'Not provided'}
Sample: ${sampleType || 'Arterial'}

LABORATORY VALUES:`;

        // Essential values
        prompt += `
Primary Gas Exchange:
• pH: ${analysisValues.ph}
• pCO2: ${analysisValues.pco2} kPa (${pco2_mmHg} mmHg)`;
        
        if (analysisValues.po2) {
            prompt += `
• pO2: ${analysisValues.po2} kPa (${po2_mmHg} mmHg)`;
        }
        
        if (analysisValues.hco3) {
            prompt += `
• HCO3-: ${analysisValues.hco3} mmol/L`;
        }
        
        if (analysisValues.be !== null && analysisValues.be !== undefined) {
            prompt += `
• Base Excess: ${analysisValues.be} mmol/L`;
        }

        // Electrolytes
        if (analysisValues.sodium || analysisValues.potassium || analysisValues.chloride) {
            prompt += `
Electrolytes:`;
            if (analysisValues.sodium) prompt += `
• Na+: ${analysisValues.sodium} mmol/L`;
            if (analysisValues.potassium) prompt += `
• K+: ${analysisValues.potassium} mmol/L`;
            if (analysisValues.chloride) prompt += `
• Cl-: ${analysisValues.chloride} mmol/L`;
        }

        // Additional parameters
        prompt += `
Additional:
• Albumin: ${analysisValues.albumin} g/L${!values.albumin ? ' (assumed)' : ''}`;
        
        if (analysisValues.lactate) {
            prompt += `
• Lactate: ${analysisValues.lactate} mmol/L`;
        }
        if (analysisValues.glucose) {
            prompt += `
• Glucose: ${analysisValues.glucose} mmol/L`;
        }
        if (analysisValues.calcium) {
            prompt += `
• Ca2+: ${analysisValues.calcium} mmol/L`;
        }
        if (analysisValues.hb) {
            prompt += `
• Hemoglobin: ${analysisValues.hb} g/L`;
        }
        if (analysisValues.fio2) {
            prompt += `
• FiO2: ${analysisValues.fio2}%`;
        }

        prompt += `

ANALYSIS REQUIRED:
Provide comprehensive interpretation following the exact JSON structure specified. Include all calculations and clinical correlation.`;

        const requestPayload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.1,
                topK: 1,
                topP: 0.8,
                maxOutputTokens: 8192,
                candidateCount: 1
            }
        };

        console.log(`[${new Date().toISOString()}] Sending comprehensive analysis to Gemini 2.5 Flash (v1beta)`);
        
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

        // Enhanced JSON parsing with better error handling
        let extractedJson;
        
        try {
            // Clean response - remove any markdown or extra text
            let cleaned = responseText.trim();
            
            // Remove markdown code blocks
            cleaned = cleaned.replace(/```json\s*/gi, '');
            cleaned = cleaned.replace(/```\s*/g, '');
            
            // Find JSON boundaries more precisely
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                
                // Additional cleaning for common issues
                cleaned = cleaned.replace(/,\s*}/g, '}'); // Remove trailing commas
                cleaned = cleaned.replace(/,\s*]/g, ']'); // Remove trailing commas in arrays
                
                extractedJson = JSON.parse(cleaned);
                console.log('JSON parsed successfully');
                
            } else {
                throw new Error('No valid JSON structure found');
            }
            
        } catch (parseError) {
            console.error('JSON parsing failed:', parseError.message);
            console.error('Response sample:', responseText.substring(0, 500));
            
            // Enhanced fallback with basic calculations
            const anionGap = values.sodium && values.chloride && values.hco3 ? 
                values.sodium - (values.chloride + values.hco3) : null;
            
            const wintersLow = values.hco3 ? (1.5 * values.hco3 + 8 - 2).toFixed(1) : null;
            const wintersHigh = values.hco3 ? (1.5 * values.hco3 + 8 + 2).toFixed(1) : null;
            
            extractedJson = {
                keyFindings: `Analysis of pH ${values.ph}, pCO2 ${values.pco2} kPa. ${values.ph < 7.35 ? "**Acidemia** present" : values.ph > 7.45 ? "**Alkalemia** present" : "Normal pH"}. ${values.lactate > 4 ? "**Critically elevated lactate**" : ""}. Detailed analysis temporarily unavailable - please retry.`,
                
                compensationAnalysis: values.hco3 && wintersLow ? 
                    `Primary disorder assessment in progress. Winter's formula suggests expected pCO2 ${wintersLow}-${wintersHigh} mmHg vs actual ${(values.pco2 * 7.5).toFixed(1)} mmHg. Please retry for complete compensation analysis.` : 
                    "Compensation analysis pending - please retry.",
                
                hhAnalysis: `Henderson-Hasselbalch Analysis:
pH: ${values.ph} (7.35-7.45) - ${values.ph < 7.35 ? "**Low**" : values.ph > 7.45 ? "**High**" : "Normal"}
pCO2: ${values.pco2} kPa (${(values.pco2 * 7.5).toFixed(1)} mmHg) - ${values.pco2 > 6.0 ? "**Elevated**" : values.pco2 < 4.7 ? "**Low**" : "Normal"}
${values.hco3 ? `HCO3-: ${values.hco3} mmol/L (22-26) - ${values.hco3 > 26 ? "**High**" : values.hco3 < 22 ? "**Low**" : "Normal"}` : ""}
${values.be ? `Base Excess: ${values.be} mmol/L (-2 to +2) - ${values.be > 2 ? "**Positive**" : values.be < -2 ? "**Negative**" : "Normal"}` : ""}
${anionGap ? `Anion Gap: ${anionGap} mmol/L (8-12) - ${anionGap > 12 ? "**Elevated**" : "Normal"}` : ""}`,
                
                stewartAnalysis: "Stewart analysis pending - please retry for complete physicochemical assessment.",
                
                additionalCalculations: values.po2 && values.fio2 ? 
                    `P/F ratio: ${(values.po2 * 7.5 / (values.fio2/100)).toFixed(0)} (>400 normal). Additional calculations pending.` : 
                    "Additional calculations pending - please retry.",
                
                differentials: `Based on available data: ${values.ph < 7.35 ? "acidosis" : values.ph > 7.45 ? "alkalosis" : "normal pH"} ${values.lactate > 4 ? "with significantly elevated lactate suggesting tissue hypoxia" : ""}. Complete differential diagnosis pending - please retry.`
            };
        }
        
        // Validate and ensure all required keys are present with minimum content
        const requiredKeys = ['keyFindings', 'compensationAnalysis', 'hhAnalysis', 'stewartAnalysis', 'additionalCalculations', 'differentials'];
        
        for (const key of requiredKeys) {
            if (!extractedJson[key] || typeof extractedJson[key] !== 'string' || extractedJson[key].length < 30) {
                extractedJson[key] = `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} analysis pending - please retry if this persists.`;
            }
        }

        const executionTime = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] Comprehensive analysis completed in ${executionTime}ms using Gemini 2.5 Flash`);

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
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};
