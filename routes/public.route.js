const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const AgentSetup = require('../models/AgentSetup');
const DatabaseSetup = require('../models/DatabaseSetup');
const ChatLog = require('../models/ChatLog');
const VisitorLead = require('../models/VisitorLead');
const { chatRateLimiter } = require('../middleware/securityMiddleware'); // 👈 Security Rate Limiter

// 1. Lead Register Endpoint (Form tab Submit handler)
router.post('/register-lead', async (req, res) => {
    try {
        const { agentId, visitorId, name, email, phone } = req.body;
        if (!agentId) {
            return res.status(400).json({ success: false, message: "Agent ID is required" });
        }

        let lead = await VisitorLead.findOne({ agentId, $or: [{ email }, { phone }, { visitorId }] });
        
        if (lead) {
            lead.name = name || lead.name;
            lead.email = email || lead.email;
            lead.phone = phone || lead.phone;
            lead.visitorId = visitorId || lead.visitorId;
            await lead.save();
        } else {
            lead = await VisitorLead.create({ agentId, visitorId, name, email, phone });
        }
        
        return res.status(200).json({ success: true, message: "Lead registered successfully", lead });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 2. GET AGENT BY ID
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

// 3. GET CHAT ANALYTICS FOR DASHBOARD
router.get('/chat-analytics/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const logs = await ChatLog.find({ agentId }).sort({ createdAt: -1 });

        const totalChats = logs.length;
        const totalDuration = logs.reduce((acc, curr) => acc + (curr.chatDurationSeconds || 0), 0);
        const avgDurationSeconds = totalChats > 0 ? Math.round(totalDuration / totalChats) : 0;

        return res.status(200).json({
            success: true,
            totalChats,
            avgDurationMinutes: (avgDurationSeconds / 60).toFixed(1),
            sessions: logs
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 4. DYNAMIC SMART CHAT ROUTE (Protected with Rate Limiter & Subscription Enforcer)
router.post('/chat', chatRateLimiter, async (req, res) => {
    try {
        const { agentId, message, visitorId, duration } = req.body;

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

        const now = new Date();

        // 🟢 SUBSCRIPTION & PLAN ENFORCEMENT LOGIC
        if (agent.planStatus === 'expired' || agent.planStatus === 'pending_approval') {
            return res.status(403).json({
                success: false,
                reply: `⚠️ Aapka plan expire ho chuka hai ya approval pending hai. AI chat service continue rakhne ke liye please dashboard se plan purchase karein.`
            });
        }

        // 1. Free, Basic, & Silver Plan Quota Checks (Message-based)
        if (['free', 'basic', 'silver'].includes(agent.planType)) {
            if (agent.messagesUsed >= agent.usageLimit) {
                agent.planStatus = 'expired';
                await agent.save();
                return res.status(403).json({
                    success: false,
                    reply: `⚠️ Aapka ${agent.planType.toUpperCase()} Plan ka message quota khatam ho gaya hai. Please dashboard se naya plan purchase karein.`
                });
            }
        }

        // 2. Golden Plan Expiry Check (Time/Month-based)
        if (agent.planType === 'golden' && agent.planEndDate) {
            if (now > new Date(agent.planEndDate)) {
                agent.planStatus = 'expired';
                await agent.save();
                return res.status(403).json({
                    success: false,
                    reply: `⚠️ Aapka Golden Subscription period khatam ho gaya hai. Please billing tab se apna plan renew karein.`
                });
            }
        }

        // 3. Proactive Expiry Warning Injection for Golden Plan (1-2 days before)
        let expiryWarningPrompt = "";
        if (agent.planType === 'golden' && agent.planEndDate) {
            const diffTime = new Date(agent.planEndDate) - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 2 && diffDays > 0) {
                expiryWarningPrompt = `\nSYSTEM NOTICE: Inform the user politely that their Golden subscription expires in ${diffDays} day(s) and remind them to renew.`;
            }
        }

        // Step 1: Dynamic Location Tracking (IP Geolocation)
        let visitorLocation = "Karachi, Pakistan";
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
            try {
                const geoRes = await axios.get(`http://ip-api.com/json/${clientIp.split(',')[0].trim()}`);
                if (geoRes.data && geoRes.data.status === 'success') {
                    visitorLocation = `${geoRes.data.city}, ${geoRes.data.country}`;
                }
            } catch (geoErr) {
                console.log("Geo IP lookup skipped:", geoErr.message);
            }
        }

        // Step 2: Save or Update Chat Metrics in MongoDB (ChatLog)
        const currentVisitor = visitorId || 'guest_session_' + Date.now();
        let chatLog = await ChatLog.findOne({ agentId, visitorId: currentVisitor });
        
        if (chatLog) {
            chatLog.chatDurationSeconds = duration || (chatLog.chatDurationSeconds + 10);
            chatLog.messageCount += 1;
            await chatLog.save();
        } else {
            chatLog = await ChatLog.create({
                agentId,
                visitorId: currentVisitor,
                destination: visitorLocation,
                chatDurationSeconds: duration || 10,
                messageCount: 1
            });
        }

        // Step 3: Smart Lead Matching & Automatic Registration via Chat
        const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = message.match(/(\+?\d{10,14})/);
        let lead = null;

        if (emailMatch || phoneMatch) {
            const queryCondition = [];
            if (emailMatch) queryCondition.push({ email: emailMatch[0] });
            if (phoneMatch) queryCondition.push({ phone: phoneMatch[0] });

            lead = await VisitorLead.findOne({ agentId, $or: queryCondition });

            if (lead) {
                lead.visitorId = currentVisitor;
                await lead.save();
            } else {
                lead = await VisitorLead.findOne({ agentId, visitorId: currentVisitor });
                if (lead) {
                    lead.email = emailMatch ? emailMatch[0] : lead.email;
                    lead.phone = phoneMatch ? phoneMatch[0] : lead.phone;
                    await lead.save();
                } else {
                    lead = await VisitorLead.create({
                        agentId,
                        visitorId: currentVisitor,
                        name: "Valued Customer",
                        email: emailMatch ? emailMatch[0] : undefined,
                        phone: phoneMatch ? phoneMatch[0] : undefined,
                    });
                }
            }
        } else {
            lead = await VisitorLead.findOne({ agentId, visitorId: currentVisitor });
        }

        // Step 4: Customer Memory Prompt Configuration
        let customerMemoryContext = "";
        if (lead && (lead.email || lead.phone)) {
            const historySummary = lead.chatHistory && lead.chatHistory.length > 0
                ? lead.chatHistory.slice(-6).map(h => `${h.sender.toUpperCase()}: ${h.message}`).join("\n")
                : "No previous chat history.";

            customerMemoryContext = `
VERIFIED REGISTERED CUSTOMER DETAILS:
- Name: ${lead.name || 'Customer'}
- Email: ${lead.email || 'N/A'}
- Phone: ${lead.phone || 'N/A'}

PREVIOUS CONVERSATION HISTORY WITH THIS CUSTOMER:
${historySummary}

PERSONALIZATION INSTRUCTIONS:
- Acknowledge that you have successfully verified their contact details.
- Greet them warmly and reference any past conversation history if available. 
- Do NOT ask them to register again since they are now verified customers.`;
        } else {
            customerMemoryContext = `
UNREGISTERED / GUEST VISITOR:
INSTRUCTION: Answer the question accurately. At the end of your response, politely add: "If you are our registered customer, please share your email/phone number, or register yourself using the Form tab!"`;
        }

        // Step 5: Connected Databases / Sheets Context Fetching
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

        const apiKey = agent.customApiKey;
        if (!apiKey) {
            return res.status(400).json({ success: false, message: "No API key configured for this Agent." });
        }

        const routesInfo = agent.routes && agent.routes.length > 0
            ? agent.routes.map(r => `${r.routeName}: ${r.routePath}`).join(', ')
            : "No specific navigation routes configured.";

        const systemPrompt = `You are a helpful AI assistant for "${agent.businessName}".
Agent Name: ${agent.agentName}

${customerMemoryContext}
${expiryWarningPrompt}

BUSINESS CONTEXT & TRAINING DATA:
${agent.businessDescription}

CONNECTED DATABASE / EXCEL / GOOGLE SHEET RECORDS:
${dbContextString}

AVAILABLE ROUTES:
${routesInfo}

INSTRUCTIONS:
- Answer questions accurately using provided business context, database records, and customer history.
- Do not use markdown symbols like bold asterisks or bullet dashes. Use clean plain text spacing.
- Keep answers polite, concise, and helpful.`;

        let aiReply = "";

        // Step 6: AI Provider Execution (Groq, Gemini, or OpenAI)
        if (agent.provider === 'groq') {
            const groqResponse = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: agent.selectedModel || "llama-3.3-70b-versatile",
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
            aiReply = groqResponse.data.choices[0].message.content;
        } else if (agent.provider === 'gemini') {
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
        } else {
            const openAiResponse = await axios.post(
                "https://api.openai.com/v1/chat/completions",
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

        // Step 7: Save Chat History in VisitorLead DB
        if (!lead) {
            lead = new VisitorLead({
                agentId,
                visitorId: currentVisitor,
                chatHistory: []
            });
        }
        lead.chatHistory.push({ sender: 'user', message });
        lead.chatHistory.push({ sender: 'bot', message: aiReply });
        await lead.save();

        // Step 8: Message Usage Count Update
        agent.messagesUsed = (agent.messagesUsed || 0) + 1;
        await agent.save();

        return res.status(200).json({
            success: true,
            reply: aiReply,
            messagesUsed: agent.messagesUsed
        });

    } catch (err) {
        console.error("AI Model API Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || "AI Model service currently unavailable."
        });
    }
});

module.exports = router;