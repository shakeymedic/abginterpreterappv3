exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-store'
    };

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Configuration error' })
            };
        }

        const { image } = JSON.parse(event.body);
        if (!image) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Image data required' })
            };
        }

        // Use Gemini 2.5 Flash for OCR
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are a precise OCR system for blood gas analysis reports.

OUTPUT RULES:
1. Return ONLY a JSON object, no other text
2. Start with { and end with }
3. No markdown, no code blocks

Required JSON structure (ALL keys must be present, use null for missing values):
{
  "ph": number or null,
  "pco2": number or null,
  "po2": number or null,
  "hco3": number or null,
  "sodium": number or null,
  "potassium": number or null,
  "chloride": number or null,
  "albumin": number or null,
  "lactate": number or null,
  "glucose": number or null,
  "calcium": number or null,
  "hb": number or null
}

EXTRACTION RULES:
- Extract ONLY numerical values, ignore units
- If pCO2 or pO2 > 20, they're likely in mmHg - convert to kPa by dividing by 7.5
- Common label mappings:
  pH: "pH"
  pCO2: "pCO2", "PCO2", "CO2"
  pO2: "pO2", "PO2", "O2"
  HCO3: "HCO3", "HCO3-", "cHCO3", "Bicarb", "HCO3(st)"
  Sodium: "Na", "Na+", "Sodium"
  Potassium: "K", "K+", "Potassium"
  Chloride: "Cl", "Cl-", "Chloride"
  Albumin: "Alb", "Albumin"
  Lactate: "Lac", "Lactate", "Lact"
  Glucose: "Glu", "Glucose", "BG", "Gluc"
  Calcium: "Ca", "Ca2+", "iCa", "Ca++", "Ion Ca"
  Hemoglobin: "Hb", "tHb", "Hemoglobin", "Hgb"`;

        const requestPayload = {
            contents: [{
                parts: [
                    { text: "Extract all blood gas values from this image. Return ONLY the JSON object:" },
                    { 
                        inlineData: { 
                            mimeType: "image/jpeg", 
                            data: image 
                        }
                    }
                ]
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            generationConfig: {
                temperature: 0.1,  // Very low for accurate OCR
                topK: 1,
                topP: 0.8,
                maxOutputTokens: 500,
                candidateCount: 1
            }
        };

        console.log(`[${new Date().toISOString()}] OCR request to Gemini 2.5 Flash`);

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload)
        });

        if (!geminiResponse.ok) {
            console.error(`OCR API error: ${geminiResponse.status}`);
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'OCR service unavailable' })
            };
        }

        const data = await geminiResponse.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'No OCR results generated' })
            };
        }

        // Parse JSON response
        let extractedValues;
        try {
            // Clean the response
            let cleaned = responseText.trim();
            
            // Remove any markdown formatting
            cleaned = cleaned.replace(/```json\s*/gi, '');
            cleaned = cleaned.replace(/```\s*/g, '');
            
            // Extract JSON object
            const startIdx = cleaned.indexOf('{');
            const endIdx = cleaned.lastIndexOf('}');
            
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const jsonStr = cleaned.substring(startIdx, endIdx + 1);
                extractedValues = JSON.parse(jsonStr);
            } else {
                extractedValues = JSON.parse(cleaned);
            }
            
            console.log('OCR values extracted successfully');
            
        } catch (error) {
            console.error('OCR JSON parse error:', error);
            console.error('Raw response:', responseText.substring(0, 200));
            
            // Return empty structure on parse failure
            extractedValues = {
                ph: null, pco2: null, po2: null, hco3: null,
                sodium: null, potassium: null, chloride: null,
                albumin: null, lactate: null, glucose: null,
                calcium: null, hb: null
            };
        }

        // Ensure all required keys exist
        const requiredKeys = ['ph', 'pco2', 'po2', 'hco3', 'sodium', 'potassium', 
                             'chloride', 'albumin', 'lactate', 'glucose', 'calcium', 'hb'];
        
        for (const key of requiredKeys) {
            if (!(key in extractedValues)) {
                extractedValues[key] = null;
            }
        }

        // Validate and convert units if needed
        if (extractedValues.pco2 && extractedValues.pco2 > 20) {
            // Likely in mmHg, convert to kPa
            extractedValues.pco2 = parseFloat((extractedValues.pco2 / 7.5).toFixed(2));
            console.log('Converted pCO2 from mmHg to kPa');
        }
        
        if (extractedValues.po2 && extractedValues.po2 > 20) {
            // Likely in mmHg, convert to kPa
            extractedValues.po2 = parseFloat((extractedValues.po2 / 7.5).toFixed(2));
            console.log('Converted pO2 from mmHg to kPa');
        }

        console.log(`[${new Date().toISOString()}] OCR completed successfully`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(extractedValues)
        };

    } catch (error) {
        console.error('OCR function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'OCR processing failed' })
        };
    }
};
