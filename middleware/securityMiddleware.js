const SecurityLog = require('../models/SecurityLog');
const AgentSetup = require('../models/AgentSetup');

// In-memory store for rate limiting (IP-based tracking)
const requestTracker = new Map();

const chatRateLimiter = async (req, res, next) => {
    try {
        const { agentId } = req.body;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 Minute window
        const maxRequests = 15; // Max 15 messages per minute per IP

        if (!requestTracker.has(clientIp)) {
            requestTracker.set(clientIp, { count: 1, startTime: now });
        } else {
            const tracker = requestTracker.get(clientIp);
            if (now - tracker.startTime < windowMs) {
                tracker.count += 1;
                if (tracker.count > maxRequests) {
                    // 🚨 SPAM / BOT SPIKE DETECTED!
                    // Log this security incident for Super Admin monitoring
                    if (agentId) {
                        const agent = await AgentSetup.findById(agentId);
                        if (agent) {
                            await SecurityLog.create({
                                agentId: agent._id,
                                userId: agent.userId,
                                clientIp: clientIp.split(',')[0].trim(),
                                attackType: 'RATE_LIMIT_EXCEEDED',
                                details: `Abnormal traffic spike detected. ${tracker.count} requests sent within 1 minute.`
                            });
                        }
                    }

                    return res.status(429).json({
                        success: false,
                        reply: "⚠️ Too many requests from your network. Please slow down."
                    });
                }
            } else {
                // Reset window
                requestTracker.set(clientIp, { count: 1, startTime: now });
            }
        }

        next();
    } catch (err) {
        console.error("Security Middleware Error:", err);
        next(); // Fallback to let request pass if error occurs
    }
};

module.exports = { chatRateLimiter };