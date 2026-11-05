const mongoose = require('mongoose');

const visitorLeadSchema = new mongoose.Schema({
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentSetup', required: true },
    visitorId: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    chatHistory: [
        {
            sender: { type: String, enum: ['user', 'bot'] },
            message: { type: String },
            timestamp: { type: Date, default: Date.now }
        }
    ],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VisitorLead', visitorLeadSchema);