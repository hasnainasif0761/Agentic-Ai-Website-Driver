const { default: mongoose } = require("mongoose");

const agentSetupSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiUser', required: true },
    businessName: { type: String, default: '' },
    businessDescription: { type: String, default: '' },
    provider: { type: String, default: '' },
    selectedModel: { type: String, default: '' },
    customApiKey: { type: String, default: '' },
    agentName: { type: String, default: 'My AI Agent' },
    planType: { type: String, enum: ['free', 'basic', 'silver', 'golden'], default: 'free' },
    planStatus: { type: String, enum: ['active', 'pending_approval', 'suspended', 'inactive', 'expired'], default: 'active' },
    planStartedAt: { type: Date, default: Date.now },
    planExpiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    gracePeriodUntil: { type: Date, default: null },
    usageLimit: { type: Number, default: 15 }, // null for 'golden' (Unlimited)
    messagesUsed: { type: Number, default: 0 },
    carryOverChats: { type: Number, default: 0 },
}, { timestamps: true });

const AgentSetup = mongoose.model('AgentSetup', agentSetupSchema);

module.exports = AgentSetup;