const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const AgentSetup = require('../models/AgentSetup');
const DatabaseSetup = require('../models/DatabaseSetup'); // Ensure karein model imported ho

// 1. GET AGENT BY ID
router.get('/agent/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid Agent ID" });
        }
        const agent = await AgentSetup.findById(req.params.id);
        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found" });
        }

        return res.status(200).json({ success: true, agent });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 2. DYNAMIC CHAT ROUTE


router.post('/chat', async (req, res) => {
    try {
        const { agentId, message } = req.body;

        if (!agentId || !message) {
            return res.status(400).json({ success: false, message: "Agent ID and message are required" });
        }

        if (!mongoose.Types.ObjectId.isValid(agentId)) {
            return res.status(400).json({ success: false, message: "Invalid Agent ID format" });
        }

        const agent = await AgentSetup.findById(agentId);
         
        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found" });
        }

        // 1. User ki sari connected databases/sheets fetch karein (find use karna hai, findOne nahi)
const dbSetups = await DatabaseSetup.find({ userId: agent.userId });

let dbContextString = "No database or Excel data connected.";
if (dbSetups && dbSetups.length > 0) {
    // Sari databases aur unki tables ko map karna
    dbContextString = dbSetups.map(db => {
        if (!db.tables || db.tables.length === 0) return '';
        return db.tables.map(t => {
            const rowsJson = JSON.stringify(t.rowsData || []);
            return `Source DB: ${db.dbName} | Table/Sheet: ${t.tableName}\nColumns: ${t.columns.join(', ')}\nData Rows: ${rowsJson}`;
        }).join('\n\n');
    }).filter(Boolean).join('\n\n');
}
        const currentLimit = agent.usageLimit || 50;
        const currentUsed = agent.messagesUsed || 0;

        if (currentUsed >= currentLimit) {
            return res.status(403).json({
                success: false,
                reply: "⚠️ Message limit reached for this AI Agent. Please upgrade your plan."
            });
        }

        // Key resolution
        const apiKey = (agent.apiKeyOption === 'own' && agent.customApiKey)
            ? agent.customApiKey
            : process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ success: false, message: "API key is missing on server." });
        }
        const routesInfo = agent.routes && agent.routes.length > 0
        ? agent.routes.map(r => `${r.routeName}: ${r.routePath}`).join(', ')
        : "No specific navigation routes configured.";

        // 🟢 2. System prompt mein database context add kar diya gaya hai
        const systemPrompt = `You are a helpful AI assistant for "${agent.businessName}".
Agent Name: ${agent.agentName}

BUSINESS CONTEXT & TRAINING DATA:
${agent.businessDescription}

CONNECTED DATABASE / EXCEL / GOOGLE SHEET RECORDS:
${dbContextString}

AVAILABLE ROUTES:
${routesInfo}

INSTRUCTIONS:
- Answer questions accurately using the provided business context and database/sheet records.
- Do not use markdown symbols like bold asterisks or bullet dashes. Use clean plain text spacing.
- Keep answers polite, concise, and helpful.`
;

// OpenRouter Call
const openRouterResponse = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "openai/gpt-4o-mini", 
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const aiReply = openRouterResponse.data.choices[0].message.content;

        return res.status(200).json({
            success: true,
            reply: aiReply,
            messagesUsed: agent.messagesUsed
        });

    } catch (err) {
        console.error("OpenRouter API Error:", err.response?.data || err.message);
        
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || "AI Model service currently unavailable."
        });
    }
});

module.exports = router;