const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const AgentSetup = require('../models/AgentSetup');
const DatabaseSetup = require('../models/DatabaseSetup');
const ChatLog = require('../models/ChatLog');
const VisitorLead = require('../models/VisitorLead');
const { chatRateLimiter } = require('../middleware/securityMiddleware');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/authMiddleware');

// 1. Lead Register Endpoint (Form tab Submit handler)
router.post('/register-lead', async (req, res) => {
    try {
        const { agentId, visitorId, name, email, phone } = req.body;
        if (!agentId) {
            return res.status(400).json({ success: false, message: "Agent ID is required" });
        }

        const cleanEmail = email ? email.trim().toLowerCase() : undefined;
        const cleanPhone = phone ? phone.trim() : undefined;

        const orConditions = [];
        if (cleanEmail) orConditions.push({ email: cleanEmail });
        if (cleanPhone) orConditions.push({ phone: cleanPhone });
        if (visitorId) orConditions.push({ visitorId }, { visitorIds: visitorId });

        let lead = orConditions.length > 0 
            ? await VisitorLead.findOne({ agentId, $or: orConditions }) 
            : null;
        
        if (lead) {
            lead.name = name || lead.name;
            lead.email = cleanEmail || lead.email;
            lead.phone = cleanPhone || lead.phone;
            lead.visitorId = visitorId || lead.visitorId;
            
            if (visitorId) {
                if (!lead.visitorIds) lead.visitorIds = [lead.visitorId];
                if (!lead.visitorIds.includes(visitorId)) {
                    lead.visitorIds.push(visitorId);
                }
            }

            await lead.save();
        } else {
            lead = await VisitorLead.create({ 
                agentId, 
                visitorId, 
                visitorIds: visitorId ? [visitorId] : [], 
                name, 
                email: cleanEmail, 
                phone: cleanPhone,
                chatHistory: []
            });
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

// 4. DYNAMIC SMART CHAT ROUTE
router.post('/chat', chatRateLimiter, async (req, res) => {
    try {
        const { agentId, message, visitorId, duration, leadId, email, phone, name } = req.body;

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

        if (agent.planStatus === 'pending_approval') {
            return res.status(403).json({
                success: false,
                paused: true,
                reason: 'pending_approval',
                reply: `⚠️ Aapka plan abhi approval ke intezar mein hai. AI chat service active hone ke baad shuru hogi.`
            });
        }

        const user = await User.findById(agent.userId).select('_id planStatus');
        if (!user) {
            return res.status(404).json({ success: false, message: "Associated business owner not found" });
        }

        // Step 2 Quota & 30-Day Validity Check + Atomic Quota Consumption
        const quotaCheck = await consumeCustomerChatQuota(user._id, 1);
        if (!quotaCheck.allowed) {
            return res.status(402).json({
                success: false,
                paused: true,
                reason: quotaCheck.reason,
                reply: `⚠️ ${quotaCheck.message}`,
                message: quotaCheck.message
            });
        }

        // Step 1: Dynamic Location Tracking
        let visitorLocation = "Karachi, Pakistan";
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
            try {
                const geoRes = await axios.get(`http://ip-api.com/json/${clientIp.split(',')[0].trim()}`);
                if (geoRes.data && geoRes.data.status === 'success') {
                    visitorLocation = `${geoRes.data.city}, ${geoRes.data.country}`;
                }
            } catch (geoErr) {}
        }

        const currentVisitor = visitorId || 'guest_session_' + Date.now();

        // Step 3: Smart Lead Matching & Unrecognized Email Verification
        const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = message.match(/(\+?\d{10,14})/);
        const nameMatch = message.match(/(?:mera name|my name is|i am|mai hu)\s+([a-zA-Z\s]+)/i);

        let clientEmail = emailMatch ? emailMatch[0].toLowerCase() : (email ? email.toLowerCase() : null);
        const clientPhone = phoneMatch ? phoneMatch[0] : (phone || null);
        const extractedName = nameMatch && nameMatch[1] ? nameMatch[1].trim().split(" ")[0] : (name || null);

        let lead = null;
        let isUnrecognizedEmail = false;

        if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
            lead = await VisitorLead.findById(leadId);
        }

        const sessionLead = await VisitorLead.findOne({
            agentId,
            $or: [{ visitorId: currentVisitor }, { visitorIds: currentVisitor }]
        });

        if (!clientEmail && sessionLead && sessionLead.email) {
            clientEmail = sessionLead.email;
        }

        if (!lead && clientEmail) {
            const existingLead = await VisitorLead.findOne({ agentId, email: clientEmail });
            if (existingLead) {
                lead = existingLead;
            } else if (emailMatch) {
                if (!sessionLead || !sessionLead.email) {
                    isUnrecognizedEmail = true;
                }
            }
        }

        if (lead) {
            if (sessionLead && sessionLead._id.toString() !== lead._id.toString()) {
                if (sessionLead.chatHistory && sessionLead.chatHistory.length > 0) {
                    lead.chatHistory.push(...sessionLead.chatHistory);
                }
                await VisitorLead.findByIdAndDelete(sessionLead._id);

                const guestChatLog = await ChatLog.findOne({ agentId, visitorId: currentVisitor });
                const masterChatLog = await ChatLog.findOne({ agentId, visitorId: lead.visitorId });

                if (guestChatLog && masterChatLog && guestChatLog._id.toString() !== masterChatLog._id.toString()) {
                    masterChatLog.messageCount += guestChatLog.messageCount;
                    masterChatLog.chatDurationSeconds += guestChatLog.chatDurationSeconds;
                    await masterChatLog.save();
                    await ChatLog.findByIdAndDelete(guestChatLog._id);
                } else if (guestChatLog && !masterChatLog) {
                    guestChatLog.visitorId = lead.visitorId;
                    await guestChatLog.save();
                }
            }

            if (clientEmail) lead.email = clientEmail;
            if (clientPhone) lead.phone = clientPhone;
            if (extractedName && extractedName !== "Valued Customer") {
                lead.name = extractedName;
            }

            if (!lead.visitorIds) lead.visitorIds = [lead.visitorId];
            if (!lead.visitorIds.includes(currentVisitor)) {
                lead.visitorIds.push(currentVisitor);
            }
            await lead.save();
        } else if (isUnrecognizedEmail) {
            if (sessionLead) {
                sessionLead.email = clientEmail;
                if (clientPhone) sessionLead.phone = clientPhone;
                if (extractedName) sessionLead.name = extractedName;
                await sessionLead.save();
                lead = sessionLead;
            } else {
                lead = await VisitorLead.create({
                    agentId,
                    visitorId: currentVisitor,
                    visitorIds: [currentVisitor],
                    name: extractedName || "Valued Customer",
                    email: clientEmail,
                    phone: clientPhone || undefined,
                    chatHistory: []
                });
            }
            isUnrecognizedEmail = true;
        } else if (sessionLead) {
            lead = sessionLead;
            if (clientEmail) lead.email = clientEmail;
            if (clientPhone) lead.phone = clientPhone;
            if (extractedName && extractedName !== "Valued Customer") lead.name = extractedName;
            await lead.save();
        } else {
            lead = await VisitorLead.create({
                agentId,
                visitorId: currentVisitor,
                visitorIds: [currentVisitor],
                name: extractedName || "Valued Customer",
                email: clientEmail || undefined,
                phone: clientPhone || undefined,
                chatHistory: []
            });
        }

        // Step 2: ChatLog Session Metrics update
        let chatLog = await ChatLog.findOne({ agentId, visitorId: lead ? lead.visitorId : currentVisitor });
        if (chatLog) {
            chatLog.chatDurationSeconds = duration || (chatLog.chatDurationSeconds + 10);
            chatLog.messageCount += 1;
            await chatLog.save();
        } else {
            chatLog = await ChatLog.create({
                agentId,
                visitorId: lead ? lead.visitorId : currentVisitor,
                destination: visitorLocation,
                chatDurationSeconds: duration || 10,
                messageCount: 1
            });
        }

        // Step 4: Strict Verification & Memory Prompt
        let customerMemoryContext = "";
        const hasValidName = lead && lead.name && lead.name !== "Valued Customer";
        const isVerified = Boolean(lead && (lead.email || lead.phone || hasValidName) && !isUnrecognizedEmail);

        if (isUnrecognizedEmail) {
            customerMemoryContext = `
UNRECOGNIZED EMAIL NOTICE:
- The user provided an email (${clientEmail}) that does NOT exist in our database.
- MANDATORY INSTRUCTION: You must politely reply: "Mujhe is email (${clientEmail}) ka koi record nahi mila. Kya aap ise record ke taur par save karna chahte hain? Agar haan, toh apna name aur phone number bhi dein."`;
        } else if (isVerified) {
            const historySummary = lead.chatHistory && lead.chatHistory.length > 0
                ? lead.chatHistory.slice(-10).map(h => `${h.sender.toUpperCase()}: ${h.message}`).join("\n")
                : "No previous messages.";

            customerMemoryContext = `
VERIFIED CUSTOMER PROFILE:
- Name: ${lead.name || 'Not provided'}
- Email: ${lead.email || 'Not provided'}
- Phone: ${lead.phone || 'Not provided'}

PREVIOUS CONVERSATION HISTORY:
${historySummary}

STRICT RULES FOR AI:
1. The user IS VERIFIED. Use these details if they ask about their name, email, or phone.
2. Never ask them to register again.
3. Reply in Roman Urdu / English (same as user).`;
        } else {
            customerMemoryContext = `
UNREGISTERED GUEST VISITOR:
- Prompt them to share their email/phone or use the Form tab if they want to register.`;
        }

        // Step 5: Connected Databases / Sheets Context Fetching
        const dbSetups = await DatabaseSetup.find({ userId: agent.userId }).lean();
let dbContextString = 'No external database or sheet connected.';

if (dbSetups && dbSetups.length > 0) {
    const userKeywords = message
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2);

    const formattedBlocks = dbSetups.map((db) => {
        if (!db.tables || db.tables.length === 0) return '';
        return db.tables
            .map((t) => {
                const columns = t.columns || [];
                const rows = t.rowsData || [];
                let relevantRows = [];

                if (userKeywords.length > 0 && rows.length > 0) {
                    relevantRows = rows.filter((row) => {
                        const rowString = JSON.stringify(row).toLowerCase();
                        return userKeywords.some((keyword) => rowString.includes(keyword));
                    });
                }

                const displayRows = relevantRows.length > 0 ? relevantRows.slice(0, 6) : rows.slice(0, 6);
                const roleLine = t.tableRole ? `Purpose/Role: ${t.tableRole}\n` : '';

                return [
                    `Source: ${db.dbName} | Tab/Table: ${t.tableName}`,
                    roleLine.trim(),
                    `Columns: ${columns.join(', ')}`,
                    `Data: ${JSON.stringify(displayRows)}`
                ]
                    .filter(Boolean)
                    .join('\n');
            })
            .filter(Boolean)
            .join('\n\n');
    }).filter(Boolean);

    if (formattedBlocks.length > 0) {
        dbContextString = formattedBlocks.join('\n\n');
    }
}

        const apiKey = agent.customApiKey;
        if (!apiKey) {
            return res.status(400).json({ success: false, message: "No API key configured." });
        }

        const systemPrompt = `You are an intelligent AI assistant for "${agent.businessName}".
Agent Name: ${agent.agentName}

${customerMemoryContext}

BUSINESS CONTEXT:
${agent.businessDescription}

DATABASE RECORDS:
${dbContextString}

INSTRUCTIONS:
- Be concise, accurate, and helpful.
- Never use markdown bold asterisks or bullet dashes. Use clean plain text spacing.`;

        let aiReply = "";
        if (agent.provider === 'groq') {
            const groqRes = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                model: agent.selectedModel || "llama-3.3-70b-versatile",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }]
            }, { headers: { "Authorization": `Bearer ${agent.customApiKey.trim()}` } });
            aiReply = groqRes.data.choices[0].message.content;
        } else if (agent.provider === 'gemini') {
            const geminiModel = agent.selectedModel || "gemini-1.5-flash";
            const geminiRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${agent.customApiKey.trim()}`, {
                contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nUser Question: ${message}` }] }]
            });
            aiReply = geminiRes.data.candidates[0].content.parts[0].text;
        } else {
            const openAiRes = await axios.post("https://api.openai.com/v1/chat/completions", {
                model: agent.selectedModel || "gpt-4o-mini",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }]
            }, { headers: { "Authorization": `Bearer ${agent.customApiKey.trim()}` } });
            aiReply = openAiRes.data.choices[0].message.content;
        }

        // Step 7: Save Chat History in Database Master Lead
        if (lead) {
            lead.chatHistory.push({ sender: 'user', message });
            lead.chatHistory.push({ sender: 'bot', message: aiReply });
            await lead.save();
        }

        // Step 8: Agent-level usage counter update
        agent.messagesUsed = (agent.messagesUsed || 0) + 1;
        await agent.save();

        const verifiedLeadPayload = isVerified && lead ? {
            _id: lead._id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone
        } : null;

        return res.status(200).json({
            success: true,
            reply: aiReply,
            messagesUsed: agent.messagesUsed,
            remainingChats: quotaCheck.remainingChats,
            lead: verifiedLeadPayload
        });

    } catch (err) {
        console.error("AI Model Error:", err.response?.data || err.message);
        const statusCode = err.response?.status;
        if (statusCode === 401) {
            return res.status(401).json({ success: false, reply: "⚠️ Configured API Key invalid hai." });
        }
        if (statusCode === 429) {
            return res.status(429).json({ success: false, reply: "⚠️ API Key ka credit/rate limit khatam ho gaya hai." });
        }
        return res.status(500).json({ success: false, message: "AI service unavailable." });
    }
});

router.post('/platform-sales-chat', async (req, res) => {
    try {
        const { message, agentId, visitorId } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: "Message is required." });
        }

        // 1. Check karein ke user ne agent generate kiya hua hai ya nahi
        if (!agentId || !mongoose.Types.ObjectId.isValid(agentId)) {
            return res.status(400).json({
                success: false,
                notConfigured: true,
                reply: "⚠️ Pehle Agent Generator tab mein ja kar apna AI Agent generate aur configure karein, phir yahan testing karein."
            });
        }

        const agent = await AgentSetup.findById(agentId);

        if (
            !agent ||
            !agent.businessDescription ||
            !agent.businessDescription.trim() ||
            !agent.provider ||
            !agent.customApiKey ||
            !agent.customApiKey.trim()
        ) {
            return res.status(400).json({
                success: false,
                notConfigured: true,
                reply: "⚠️ Pehle Agent Generator tab mein ja kar apna AI Agent generate aur configure karein, phir yahan testing karein."
            });
        }

        // 2. Owner (User) ka data fetch karein taake visitorId mein uska naam/email/phone save ho
        const owner = await User.findById(agent.userId).select('name email phone businessName');
        if (!owner) {
            return res.status(404).json({ success: false, message: "Associated business owner not found." });
        }

        // 3. Plan Status, 30-Day Expiry aur Quota Check
        const now = Date.now();
        const isUnlimited = agent.planType === 'golden' || agent.usageLimit === null;

        if (agent.planStatus === 'suspended') {
            return res.status(403).json({
                success: false,
                paused: true,
                reply: "⚠️ Aapka account suspend hai. Administration se rabta karein."
            });
        }

        if (agent.planStatus === 'pending_approval') {
            return res.status(403).json({
                success: false,
                paused: true,
                reply: "⚠️ Aapka plan abhi approval ke intezar mein hai. Approval ke baad chat active hogi."
            });
        }

        const expiresAtMs = agent.planExpiresAt
            ? new Date(agent.planExpiresAt).getTime()
            : new Date(agent.createdAt || now).getTime() + 30 * 24 * 60 * 60 * 1000;
        const graceMs = agent.gracePeriodUntil ? new Date(agent.gracePeriodUntil).getTime() : 0;
        const effectiveExpiryMs = Math.max(expiresAtMs, graceMs);

        if (agent.planStatus === 'expired' || now >= effectiveExpiryMs) {
            if (agent.planStatus !== 'expired') {
                agent.planStatus = 'expired';
                await agent.save();
            }
            return res.status(402).json({
                success: false,
                paused: true,
                reply: "⚠️ Aapke plan ki 30 din ki muddat khatam (expire) ho chuki hai. Plans & Billing tab se renew karein."
            });
        }

        const totalLimit = isUnlimited ? null : (agent.usageLimit || 0) + (agent.carryOverChats || 0);
        const currentUsed = agent.messagesUsed || 0;

        if (!isUnlimited && currentUsed >= totalLimit) {
            agent.planStatus = 'expired';
            await agent.save();
            return res.status(402).json({
                success: false,
                paused: true,
                reply: "⚠️ Aapka message quota mukammal ho gaya hai. Mazeed chats ke liye apna plan upgrade ya renew karein."
            });
        }

        // 4. User ke apne configured routes aur connected databases fetch karein
        const routesList = Array.isArray(agent.routes) && agent.routes.length > 0
            ? agent.routes
                .filter(r => r && (r.routeName || r.routePath))
                .map(r => `- ${r.routeName || 'Page'}: ${r.routePath || '/'}`)
                .join('\n')
            : 'No website navigation routes configured.';

const dbSetups = await DatabaseSetup.find({ userId: agent.userId }).lean();
let dbContextString = 'No external database or sheet connected.';

if (dbSetups && dbSetups.length > 0) {
    const userKeywords = message
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2);

    const formattedBlocks = dbSetups.map((db) => {
        if (!db.tables || db.tables.length === 0) return '';
        return db.tables
            .map((t) => {
                const columns = t.columns || [];
                const rows = t.rowsData || [];
                let relevantRows = [];

                if (userKeywords.length > 0 && rows.length > 0) {
                    relevantRows = rows.filter((row) => {
                        const rowString = JSON.stringify(row).toLowerCase();
                        return userKeywords.some((keyword) => rowString.includes(keyword));
                    });
                }

                const displayRows = relevantRows.length > 0 ? relevantRows.slice(0, 6) : rows.slice(0, 6);
                const roleLine = t.tableRole ? `Purpose/Role: ${t.tableRole}\n` : '';

                return [
                    `Source: ${db.dbName} | Tab/Table: ${t.tableName}`,
                    roleLine.trim(),
                    `Columns: ${columns.join(', ')}`,
                    `Data: ${JSON.stringify(displayRows)}`
                ]
                    .filter(Boolean)
                    .join('\n');
            })
            .filter(Boolean)
            .join('\n\n');
    }).filter(Boolean);

    if (formattedBlocks.length > 0) {
        dbContextString = formattedBlocks.join('\n\n');
    }
}

        // 5. User ka apna system prompt + database context
        const systemPrompt = `You are an intelligent AI assistant for "${agent.businessName || owner.businessName || 'Business'}".
Agent Name: ${agent.agentName || 'AI Assistant'}

CURRENT WORKSPACE USER (OWNER):
- Name: ${owner.name}
- Email: ${owner.email}
- Phone: ${owner.phone || 'Not provided'}

BUSINESS DESCRIPTION & SYSTEM PROMPT:
${agent.businessDescription}

WEBSITE NAVIGATION ROUTES:
${routesList}

CONNECTED DATABASE RECORDS:
${dbContextString}

INSTRUCTIONS:
- Answer strictly based on the business description, website routes, and database records above.
- Be concise, accurate, and helpful in the same language (English or Roman Urdu) as the user.
- Never use markdown bold asterisks or bullet dashes. Use clean plain text spacing.`;

        const provider = agent.provider.toLowerCase();
        const userApiKey = agent.customApiKey.trim();
        let aiReply = '';

        // 6. Sirf user ki apni API key aur provider/model se AI call karein
        if (provider === 'groq') {
            const groqRes = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: agent.selectedModel || "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: message }
                    ]
                },
                { headers: { "Authorization": `Bearer ${userApiKey}` } }
            );
            aiReply = groqRes.data.choices[0].message.content;
        } else if (provider === 'gemini') {
            const geminiModel = agent.selectedModel || "gemini-2.5-flash";
            const geminiRes = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${userApiKey}`,
                {
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: `${systemPrompt}\n\nUser Question: ${message}` }]
                        }
                    ]
                }
            );
            aiReply = geminiRes.data.candidates[0].content.parts[0].text;
        } else {
            const openAiRes = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: agent.selectedModel || "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: message }
                    ]
                },
                { headers: { "Authorization": `Bearer ${userApiKey}` } }
            );
            aiReply = openAiRes.data.choices[0].message.content;
        }

        // 7. VisitorLead & ChatLog mein ushi user ka naam + visitorId record karein
        const resolvedVisitorId = visitorId || `workspace_${owner._id}`;
        const ownerDisplayName = `${owner.name} (Workspace)`;

        let lead = await VisitorLead.findOne({
            agentId: agent._id,
            $or: [{ visitorId: resolvedVisitorId }, { email: owner.email.toLowerCase() }]
        });

        if (lead) {
            lead.name = ownerDisplayName;
            lead.email = owner.email.toLowerCase();
            if (owner.phone) lead.phone = owner.phone;
            if (!lead.visitorIds) lead.visitorIds = [lead.visitorId];
            if (!lead.visitorIds.includes(resolvedVisitorId)) {
                lead.visitorIds.push(resolvedVisitorId);
            }
            lead.chatHistory.push({ sender: 'user', message });
            lead.chatHistory.push({ sender: 'bot', message: aiReply });
            await lead.save();
        } else {
            lead = await VisitorLead.create({
                agentId: agent._id,
                visitorId: resolvedVisitorId,
                visitorIds: [resolvedVisitorId],
                name: ownerDisplayName,
                email: owner.email.toLowerCase(),
                phone: owner.phone || undefined,
                chatHistory: [
                    { sender: 'user', message },
                    { sender: 'bot', message: aiReply }
                ]
            });
        }

        let chatLog = await ChatLog.findOne({ agentId: agent._id, visitorId: lead.visitorId });
        if (chatLog) {
            chatLog.messageCount += 1;
            chatLog.chatDurationSeconds += 10;
            await chatLog.save();
        } else {
            await ChatLog.create({
                agentId: agent._id,
                visitorId: lead.visitorId,
                destination: "Dashboard Workspace",
                chatDurationSeconds: 10,
                messageCount: 1
            });
        }

        // 8. messagesUsed + 1 increment karein
        agent.messagesUsed = currentUsed + 1;
        await agent.save();

        const remainingChats = isUnlimited
            ? null
            : Math.max(0, totalLimit - agent.messagesUsed);

        return res.status(200).json({
            success: true,
            reply: aiReply,
            messagesUsed: agent.messagesUsed,
            remainingChats,
            visitorName: ownerDisplayName
        });
    } catch (err) {
        console.error("Workspace Agent Chat Error:", err.response?.data || err.message);
        const statusCode = err.response?.status;
        if (statusCode === 401) {
            return res.status(401).json({
                success: false,
                reply: "⚠️ Aapki configured API Key invalid hai. Agent Generator tab mein ja kar sahi key update karein."
            });
        }
        if (statusCode === 429) {
            return res.status(429).json({
                success: false,
                reply: "⚠️ Aapki API Key ka credit/rate limit khatam ho gaya hai."
            });
        }
        return res.status(500).json({
            success: false,
            message: err.response?.data?.error?.message || "Agent AI service unavailable."
        });
    }
});

router.get('/visitor-chats/:visitorId', async (req, res) => {
    try {
        const { visitorId } = req.params;
        const lead = await VisitorLead.findOne({ $or: [{ visitorId }, { visitorIds: visitorId }] });
        return res.status(200).json({ success: true, chatHistory: lead ? lead.chatHistory : [] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/platform-sales-chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: "Message is required" });
        }

        const apiKey = process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ success: false, message: "Platform OpenAI API key is missing on server." });
        }

        const systemPrompt = `You are the friendly, professional sales and onboarding AI expert for our AI Agent Builder Platform.
Your mission is to warmly welcome visitors (such as educational institute owners, academy leaders, and business owners) and guide them toward building a custom AI agent.

STRICT RESPONSE RULES:
- Keep your responses short, concise, and direct (maximum 2 to 3 crisp sentences). Never output long paragraphs or walls of text.
- Be polite, welcoming, reassuring, and highly engaging.
- Highlight key platform value in a quick line: quick setup with their own Database/Excel/Google Sheets using top models (OpenAI, Groq, Gemini).
- Do not use markdown symbols like bold asterisks or bullet dashes. Use clean plain text spacing.
- Always end with a short, inviting follow-up question to keep the conversation interactive.`;

        const openAiResponse = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "gpt-4o-mini",
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

router.get('/getAgent',authMiddleware,async(req,res)=>{
    console.log(req.user?._id)
    const userId = req.user?._id || req.user?.id || req.body?.userId;
        const agent = await AgentSetup.findOne({userId});
        return res.status(200).json({
                success:true,
                data:agent
    })
})

module.exports = router;