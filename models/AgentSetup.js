const mongoose = require('mongoose');

const AgentSetupSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    agentName: { type: String, required: true },
    businessName: { type: String, required: true },
    businessDescription: { type: String, required: true },

    // Source Connection Type: 'sql', 'googlesheet', or 'excel'
    dataSourceType: { type: String, default: 'sql' },
    
    // Google Sheet / Excel Specific Fields
    googleSheetUrl: { type: String, default: '' },
    excelFileName: { type: String, default: '' },
    selectedSheetsOrTables: [{ type: String }],

    // 🟢 New Provider & Model Settings (Purani apiKeyOption hata di gayi hai)
    provider: { type: String, default: 'openai' },         // e.g. 'openai', 'groq', 'gemini'
    selectedModel: { type: String, default: 'gpt-4o-mini' }, // e.g. 'llama-3.3-70b-versatile', 'gemini-1.5-flash'
    customApiKey: { type: String, required: true },          // User ki apni API key (Required)
    
    // Custom Navigation Routes
    routes: [
        {
            routeName: { type: String, required: true }, // e.g. "About Us"
            routePath: { type: String, required: true }  // e.g. "/about"
        }
    ],

    // Plan & Usage Tracking
    messagesUsed: { type: Number, default: 0 },
    usageLimit: { type: Number, default: 30 }, // Free plan Limit
    plan: { type: String, enum: ['Free', 'Pro', 'Premium'], default: 'Free' },

    // Widget Embed Script Unique Identifier
    widgetScriptUrl: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('AgentSetup', AgentSetupSchema);