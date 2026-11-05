const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSetup', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    clientIp: { type: String, required: true },
    attackType: { type: String, enum: ['RATE_LIMIT_EXCEEDED', 'SPAM_BOT_SPIKE', 'TOKEN_BURNING'], required: true },
    details: { type: String, required: true },
    status: { type: String, enum: ['unresolved', 'resolved', 'blocked'], default: 'unresolved' }
}, { timestamps: true });

module.exports = mongoose.model('SecurityLog', securityLogSchema);