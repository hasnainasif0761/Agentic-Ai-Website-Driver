const { default: mongoose } = require("mongoose");

const agentSetupSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiUser', required: true },
    businessName: { type: String, default: '' },
    businessDescription: { type: String, default: '' },
    provider: { type: String, default: '' },
    selectedModel: { type: String, default: '' },
    customApiKey: { type: String, default: '' },
    agentName: { type: String, default: 'My AI Agent' },
    planType: { type: String, default: 'free' },
    planStatus: { type: String, default: 'active' },
    usageLimit: { type: Number, default: 15 },
    messagesUsed: { type: Number, default: 0 },
}, { timestamps: true });

const AgentSetup = mongoose.model('AgentSetup', agentSetupSchema);

module.exports = AgentSetup;