const AgentSetup = require('../models/AgentSetup');

// Create or Update AI Agent Config (With Google Sheets & Excel Support)
const saveOrUpdateAgent = async (req, res) => {
    console.log("Ya request aye ha",req)
    try {
        const { 
            agentId, 
            agentName, 
            businessName, 
            businessDescription, 
            dataSourceType, 
            googleSheetUrl, 
            excelFileName, 
            selectedSheetsOrTables, 
            apiKeyOption, 
            customApiKey, 
            routes 
        } = req.body;
        // Ensure user is attached by authentication middleware
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access. Please login first ea gaya ab." });
        }

        const userId = req.user.id; // User Auth Middleware se
        let agent;

        if (agentId) {
            // Update Existing Agent
            agent = await AgentSetup.findOneAndUpdate(
                { _id: agentId, userId },
                { 
                    agentName, 
                    businessName, 
                    businessDescription, 
                    dataSourceType: dataSourceType || 'sql',
                    googleSheetUrl: googleSheetUrl || '',
                    excelFileName: excelFileName || '',
                    selectedSheetsOrTables: selectedSheetsOrTables || [],
                    apiKeyOption, 
                    customApiKey, 
                    routes 
                },
                { new: true }
            );
        } else {
            // Create New Agent
            agent = await AgentSetup.create({
                userId,
                agentName,
                businessName,
                businessDescription,
                dataSourceType: dataSourceType || 'sql',
                googleSheetUrl: googleSheetUrl || '',
                excelFileName: excelFileName || '',
                selectedSheetsOrTables: selectedSheetsOrTables || [],
                apiKeyOption,
                customApiKey,
                routes
            });
            
            // Dynamic CDN Script URL
            agent.widgetScriptUrl = `<script src="http://localhost:5000/widget.js" data-agent-id="${agent._id}" async></script>`;
            await agent.save();
        }

        return res.status(200).json({
            message: agentId ? "Agent Updated Successfully!" : "Agent Created Successfully!",
            agent
        });
    } catch (error) {
        console.log(error)
        return res.status(500).json({ message: error.message });
    }
};

// Get User Agent Data
const getUserAgent = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access." });
        }

        const agent = await AgentSetup.findOne({ userId: req.user.id });
        if (!agent) {
            return res.status(200).json({ exists: false });
        }
        return res.status(200).json({ exists: true, agent });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

module.exports = { saveOrUpdateAgent, getUserAgent };