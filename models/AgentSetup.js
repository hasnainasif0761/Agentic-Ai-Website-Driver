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

    // API Key settings
    apiKeyOption: { type: String, enum: ['own', 'system'], default: 'system' },
    customApiKey: { type: String, default: '' },
    
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