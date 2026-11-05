const express = require('express');
const router = express.Router();
const ChatLog = require('../models/ChatLog');
const AgentSetup = require('../models/AgentSetup');
const axios = require('axios');

// 🟢 1. Public Chat Endpoint (Widget integration ke liye)
router.post('/public/chat', async (req, res) => {
    try {
        const { agentId, message, visitorId, duration } = req.body;
        if (!agentId || !message) {
            return res.status(400).json({ success: false, message: "Agent ID and message are required." });
        }

        const agent = await AgentSetup.findById(agentId);
        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found." });
        }

        // Dynamic IP Geolocation lookup
        let visitorLocation = "Local Network / Karachi";
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
            try {
                const geoRes = await axios.get(`http://ip-api.com/json/${clientIp}`);
                if (geoRes.data && geoRes.data.status === 'success') {
                    visitorLocation = `${geoRes.data.city}, ${geoRes.data.country}`;
                }
            } catch (geoErr) {
                console.log("Geo IP lookup skipped");
            }
        }

        // Log or Update Chat Session metrics dynamically
        const currentVisitor = visitorId || 'guest_session_' + Date.now();
        let chatLog = await ChatLog.findOne({ agentId, visitorId: currentVisitor });
        
        if (chatLog) {
            chatLog.chatDurationSeconds += (duration || 15); // incremental duration
            chatLog.messageCount += 1;
            await chatLog.save();
        } else {
            await ChatLog.create({
                agentId,
                visitorId: currentVisitor,
                destination: visitorLocation,
                chatDurationSeconds: duration || 15,
                messageCount: 1
            });
        }

        // AI Response generation (Aapke existing LLM handler ke mutabiq)
        // Yahan aap apna Groq/OpenAI response logic call karenge
        const reply = "This is a dynamic response based on your agent context.";

        return res.status(200).json({ success: true, reply });
    } catch (err) {
        console.error("Public Chat Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 🟢 2. Fetch Isolated Analytics for Dashboard per Agent
router.get('/chat-analytics/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const logs = await ChatLog.find({ agentId }).sort({ createdAt: -1 });

        const totalChats = logs.length;
        const totalDuration = logs.reduce((acc, curr) => acc + curr.chatDurationSeconds, 0);
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

module.exports = router;