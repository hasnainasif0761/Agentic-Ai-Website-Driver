const mongoose = require('mongoose');

const agentSetupSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    agentName: { type: String, required: true },
    businessName: { type: String, required: true },
    businessDescription: { type: String, required: true },
    provider: { type: String, required: true },
    selectedModel: { type: String, required: true },
    customApiKey: { type: String, required: true },
    routes: [{ routeName: String, routePath: String }],
    
    // 🟢 1. PLAN & SUBSCRIPTION FIELDS
    planType: { 
        type: String, 
        enum: ['free', 'basic', 'silver', 'golden'], 
        default: 'free' 
    },
    planStatus: { 
        type: String, 
        enum: ['active', 'expired', 'pending_approval'], 
        default: 'active' 
    },
    usageLimit: { type: Number, default: 15 }, // Free Plan = 15 Messages
    messagesUsed: { type: Number, default: 0 },
    
    // Free plan usage tracking flags
    isFreePlanUsed: { type: Boolean, default: false },

    // Time-based tracking (For Golden or subscription validity)
    planStartDate: { type: Date, default: Date.now },
    planEndDate: { type: Date }, 

    // Fake Payment / Admin Approval Payload
    pendingPaymentDetails: {
        transactionId: String,
        requestedPlan: String,
        submittedAt: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('AgentSetup', agentSetupSchema);