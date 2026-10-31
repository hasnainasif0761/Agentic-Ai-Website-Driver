const AgentSetup = require('../models/AgentSetup');
const axios = require('axios');

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
        const { 
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

        const userId = req.user.id;
        let agent;

        if (agentId) {
            agent = await AgentSetup.findOneAndUpdate(
                { _id: agentId, userId },
                { agentName, businessName, businessDescription, dataSourceType, googleSheetUrl, excelFileName, selectedSheetsOrTables, provider, selectedModel, customApiKey, routes },
                { new: true }
            );
        } else {
            agent = await AgentSetup.create({
                userId, agentName, businessName, businessDescription, dataSourceType, googleSheetUrl, excelFileName, selectedSheetsOrTables, provider, selectedModel, customApiKey, routes
            });
            agent.widgetScriptUrl = `<script src="http://localhost:5000/widget.js" data-agent-id="${agent._id}" async></script>`;
            await agent.save();
        }

        return res.status(200).json({ success: true, message: "Agent saved successfully!", agent });
    } catch (error) {
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
        if (!agent) {
            return res.status(200).json({ exists: false });
        }
        return res.status(200).json({ exists: true, agent });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};


module.exports = { saveOrUpdateAgent, getUserAgent, validateApiKey};