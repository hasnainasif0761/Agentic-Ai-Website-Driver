const AgentSetup = require('../models/AgentSetup');

const xlsx = require('xlsx');
const axios = require('axios');





// 🟢 2. Fetch Columns Route (Headers extraction)
async function validateApiKey(provider, apiKey) {
    try {
        if (!apiKey || apiKey.trim() === '') return false;

        if (provider === 'openai') {
            const res = await axios.get('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
            });
            return res.status === 200;
        } 
        else if (provider === 'groq') {
            const res = await axios.get('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
            });
            return res.status === 200;
        } 
        else if (provider === 'gemini') {
            const res = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`);
            return res.status === 200;
        }
        return false;
    } catch (err) {
        return false; // Key invalid ya network issue par Catch block hit hoga
    }
}
// Create or Update AI Agent Config (With Google Sheets & Excel Support)
const saveOrUpdateAgent = async (req, res) => {
    try {
        let { 
            agentId, agentName, businessName, businessDescription, 
            dataSourceType, googleSheetUrl, excelFileName, selectedSheetsOrTables, 
            provider, selectedModel, customApiKey, routes 
        } = req.body;

        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, message: "Unauthorized access." });
        }

        // 🟢 API Key Validation Check
        if (!customApiKey || customApiKey.trim() === '') {
            return res.status(400).json({ success: false, message: "API key is required." });
        }

        const isValidKey = await validateApiKey(provider, customApiKey);
        if (!isValidKey) {
            return res.status(400).json({ 
                success: false, 
                message: `Please enter a valid or correct API key for ${provider.toUpperCase()}.` 
            });
        }

        // FormData barobar single ya multi-array columns parse karne
        if (typeof selectedSheetsOrTables === 'string') {
            try {
                selectedSheetsOrTables = JSON.parse(selectedSheetsOrTables);
            } catch (e) {
                selectedSheetsOrTables = [selectedSheetsOrTables];
            }
        }

        const userId = req.user.id;
        let agent;

        // Domain Dynamic URL (Production Deployment ready)
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

        if (agentId) {
            agent = await AgentSetup.findOneAndUpdate(
                { _id: agentId, userId },
                { 
                    agentName, businessName, businessDescription, 
                    dataSourceType, googleSheetUrl, excelFileName, 
                    selectedSheetsOrTables, provider, selectedModel, 
                    customApiKey, routes 
                },
                { new: true }
            );
        } else {
            agent = await AgentSetup.findOneAndUpdate(
                { userId },
                {
                    $set: {
                        agentName,
                        businessName,
                        businessDescription,
                        dataSourceType,
                        googleSheetUrl,
                        excelFileName,
                        selectedSheetsOrTables,
                        provider,
                        selectedModel,
                        customApiKey,
                        routes
                    }
                },
                { new: true, upsert: true, runValidators: false }
            );

            agent.widgetScriptUrl = `<script src="${baseUrl}/widget.js" data-agent-id="${agent._id}" async></script>`;
            await agent.save();
        }

        return res.status(200).json({ success: true, message: "Agent saved successfully!", agent });
    } catch (error) {
        console.error("Save Agent Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Get User Agent Data
const getUserAgent = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access." });
        }

        const agent = await AgentSetup.findOne({ userId: req.user.id });
        
        // 🟢 Check if agent exists AND has been actually configured (has description & provider)
        if (!agent || !agent.businessDescription || !agent.provider) {
            return res.status(200).json({ exists: false });
        }

        return res.status(200).json({ exists: true, agent });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};


module.exports = { saveOrUpdateAgent, getUserAgent, validateApiKey};