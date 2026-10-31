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

        // 1. User ki sari connected databases/sheets fetch karein
        const dbSetups = await DatabaseSetup.find({ userId: agent.userId });

        let dbContextString = "No database or Excel data connected.";
        if (dbSetups && dbSetups.length > 0) {
            dbContextString = dbSetups.map(db => {
                if (!db.tables || db.tables.length === 0) return '';
                return db.tables.map(t => {
                    const rowsJson = JSON.stringify(t.rowsData || []);
                    return `Source DB: ${db.dbName} | Table/Sheet: ${t.tableName}\nColumns: ${t.columns.join(', ')}\nData Rows: ${rowsJson}`;
                }).join('\n\n');
            }).filter(Boolean).join('\n\n');
        }

        // Usage Limit Check
        const currentLimit = agent.usageLimit || 50;
        const currentUsed = agent.messagesUsed || 0;

        if (currentUsed >= currentLimit) {
            return res.status(403).json({
                success: false,
                reply: "⚠️ Message limit reached for this AI Agent. Please upgrade your plan.",
            });
        }

        // 🟢 2. User ki apni Custom API Key use karein
        const apiKey = agent.customApiKey;

        if (!apiKey) {
            return res.status(400).json({ success: false, message: "No API key configured for this Agent." });
        }

        const routesInfo = agent.routes && agent.routes.length > 0
            ? agent.routes.map(r => `${r.routeName}: ${r.routePath}`).join(', ')
            : "No specific navigation routes configured.";

        // System Prompt
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
- Keep answers polite, concise, and helpful.`;

        // 🟢 3. Selected Model formatting (OpenRouter / Direct API Call)
        // Agar aap OpenRouter use kar rahe hain toh model path `provider/model` hota hai
        let targetModel = agent.selectedModel || "gpt-4o-mini";
        if (agent.provider && !targetModel.includes('/')) {
            targetModel = `${agent.provider}/${targetModel}`;
        }

        // OpenRouter Call (User की Key aur Selected Model ke sath)
        let aiReply = "";

        // 🟢 1. GROQ PROVIDER DIRECT CALL
        if (agent.provider === 'groq') {
            const groqResponse = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions", // 👈 Groq Native Endpoint
                {
                    model: agent.selectedModel || "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: message }
                    ]
                },
                {
                    headers: {
                        "Authorization": `Bearer ${agent.customApiKey.trim()}`, // 👈 Groq Key (gsk_...)
                        "Content-Type": "application/json"
                    }
                }
            );
            aiReply = groqResponse.data.choices[0].message.content;
        } 

        // 🟢 2. GEMINI PROVIDER DIRECT CALL
        else if (agent.provider === 'gemini') {
            const geminiModel = agent.selectedModel || "gemini-1.5-flash";
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${agent.customApiKey.trim()}`;
            
            const geminiResponse = await axios.post(
                geminiUrl,
                {
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: `${systemPrompt}\n\nUser Question: ${message}` }]
                        }
                    ]
                },
                {
                    headers: { "Content-Type": "application/json" }
                }
            );
            aiReply = geminiResponse.data.candidates[0].content.parts[0].text;
        } 

        // 🟢 3. OPENAI / OPENROUTER DIRECT CALL
        else {
            const openAiResponse = await axios.post(
                "https://api.openai.com/v1/chat/completions", // 👈 Agar direct OpenAI key hai
                {
                    model: agent.selectedModel || "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: message }
                    ]
                },
                {
                    headers: {
                        "Authorization": `Bearer ${agent.customApiKey.trim()}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            aiReply = openAiResponse.data.choices[0].message.content;
        }

        // Message usage increment karein
        agent.messagesUsed = (agent.messagesUsed || 0) + 1;
        await agent.save();

        return res.status(200).json({
            success: true,
            reply: aiReply,
            messagesUsed: agent.messagesUsed
        });

    } catch (err) {
        console.error("AI Model API Error:", err.response?.data || err.message);
        // console.log("error ai res",err)
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || "AI Model service currently unavailable."
        });
    }
});

router.post('/platform-sales-chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: "Message is required" });
        }

        // System ki apni OpenAI API key `.env` file se uthayega
        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ success: false, message: "Platform OpenAI API key is missing on server." });
        }

        // 🟢 Powerful Sales & Trust-Building System Prompt
const systemPrompt = `You are the friendly, professional sales and onboarding AI expert for our AI Agent Builder Platform.
Your mission is to warmly welcome visitors (such as educational institute owners, academy leaders, and business owners) and guide them toward building a custom AI agent.

STRICT RESPONSE RULES:
- Keep your responses short, concise, and direct (maximum 2 to 3 crisp sentences). Never output long paragraphs or walls of text.
- Be polite, welcoming, reassuring, and highly engaging.
- Highlight key platform value in a quick line: quick setup with their own Database/Excel/Google Sheets using top models (OpenAI, Groq, Gemini).
- Do not use markdown symbols like bold asterisks or bullet dashes. Use clean plain text spacing.
- Always end with a short, inviting follow-up question to keep the conversation interactive.`;

        // OpenAI Direct API Call (Using Platform's Central Key)
        const openAiResponse = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "gpt-4o-mini", // Aap chahay toh "gpt-4o" bhi kar sakte hain
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

        const aiReply = openAiResponse.data.choices[0].message.content;

        return res.status(200).json({
            success: true,
            reply: aiReply
        });

    } catch (err) {
        console.error("Platform Sales Chat Error:", err.response?.data || err.message);
        
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || "Sales AI service currently unavailable."
        });
    }
});

module.exports = router;