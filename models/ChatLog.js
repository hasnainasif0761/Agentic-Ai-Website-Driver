const mongoose = require('mongoose');

const chatLogSchema = new mongoose.Schema({
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSetup', required: true },
    visitorId: { type: String, required: true }, // Unique browser session ID
    destination: { type: String, default: 'Karachi, Pakistan' }, // Dynamic IP location
    chatDurationSeconds: { type: Number, default: 0 }, // Total time spent in seconds
    messageCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatLog', chatLogSchema);