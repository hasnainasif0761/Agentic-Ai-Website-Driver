const mysql = require('mysql2/promise');
const Groq = require("groq-sdk");
const DatabaseSetup = require('../models/DatabaseSetup'); 
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');
const ChatLog = require('../models/ChatLog'); 
const VisitorLead = require('../models/VisitorLead');
const AgentSetup = require('../models/AgentSetup');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Database connection and table fetch handler
const connectDatabase = async (req, res) => {
    try {
        const { host, user, database } = req.body;

        if (!host || !user || !database) {
            return res.status(400).json({ message: "Host, user, and database fields are required." });
        }

        const dummyTables = ["users", "orders", "products", "transactions", "logs"];

        return res.status(200).json({
            message: "Database Connected Successfully!",
            tables: dummyTables
        });
    } catch (error) {
        console.error("DB Connection Error:", error);
        return res.status(500).json({ message: "Failed to connect to database." });
    }
};

// 1. Fetch Databases List
const fetchDatabases = async (req, res) => {
    let connection;
    try {
        const { host, port, user, password } = req.body;
        connection = await mysql.createConnection({
            host, port: Number(port) || 3306, user, password: password || '', connectTimeout: 10000
        });
        const [rows] = await connection.query("SHOW DATABASES;");
        const databases = rows.map(r => Object.values(r)[0]).filter(db => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db));
        return res.status(200).json({ message: "Connected", databases });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};

// 2. Fetch Tables List
const fetchTables = async (req, res) => {
    let connection;
    try {
        const { host, port, user, password, database } = req.body;
        connection = await mysql.createConnection({
            host, port: Number(port) || 3306, user, password: password || '', database
        });
        const [rows] = await connection.query("SHOW TABLES;");
        const tables = rows.map(r => Object.values(r)[0]);
        return res.status(200).json({ tables });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    } finally {
        if (connection) await connection.end();
    }
};

// 3. Save Selected Database & Tables (User Isolated)
const saveDatabaseSetup = async (req, res) => {
    let connection;
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access. Please login first." });
        }

        const userId = req.user.id;
        const { host, port, user, password, database, dataSourceType, googleSheetUrl } = req.body;
        
        // 🟢 0. Normalize selectedTables/selectedColumns array from FormData
        let chosenColumns = [];
        if (req.body.selectedTables) {
            if (Array.isArray(req.body.selectedTables)) {
                chosenColumns = req.body.selectedTables;
            } else if (typeof req.body.selectedTables === 'string') {
                try {
                    chosenColumns = JSON.parse(req.body.selectedTables);
                } catch (e) {
                    chosenColumns = [req.body.selectedTables];
                }
            }
        }

        // 🟢 1. Agar User ne EXCEL FILE Upload ki hai (req.file exist karta hai)
        if (req.file) {
            // Buffer se Excel file parse karein
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const tablesData = [];

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const fullRowsJson = xlsx.utils.sheet_to_json(sheet);

                if (fullRowsJson.length > 0) {
                    const allColumnsInSheet = Object.keys(fullRowsJson[0]);

                    // Check karein ke user ne specific columns select kiye hain ya sab
                    const finalColumnsToKeep = chosenColumns.length > 0 
                        ? chosenColumns.filter(col => allColumnsInSheet.includes(col))
                        : allColumnsInSheet;

                    // 🎯 FILTERING: Sirf selected columns ka data nikaalein
                    const filteredRowsData = fullRowsJson.map(row => {
                        let filteredRow = {};
                        finalColumnsToKeep.forEach(col => {
                            if (row[col] !== undefined) {
                                filteredRow[col] = row[col];
                            }
                        });
                        return filteredRow;
                    });

                    tablesData.push({
                        tableName: sheetName,
                        columns: finalColumnsToKeep,
                        rowsData: filteredRowsData
                    });
                }
            });

            if (tablesData.length === 0) {
                return res.status(400).json({ message: "Uploaded Excel sheet is empty or invalid." });
            }

            const newSetup = await DatabaseSetup.create({
                userId,
                dbName: req.file.originalname,
                host: "Uploaded Excel File",
                user: req.user.name || "User",
                tables: tablesData,
                totalTablesCount: tablesData.length
            });

            return res.status(200).json({
                message: "Excel Selected Columns Successfully Parsed & Saved to User Profile!",
                setupId: newSetup._id,
                savedData: newSetup
            });
        }

        // 🟢 2. Agar Google Sheet URL hai
        if (dataSourceType === 'googlesheet' || googleSheetUrl) {
            try {
                const match = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
                if (!match || !match[1]) {
                    return res.status(400).json({ message: "Invalid Google Sheet URL format." });
                }

                const sheetId = match[1];
                const csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

                const response = await axios.get(csvExportUrl, { 
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                
                const workbook = xlsx.read(response.data, { type: 'buffer' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const fullRowsJson = xlsx.utils.sheet_to_json(sheet);

                if (!fullRowsJson || fullRowsJson.length === 0) {
                    return res.status(400).json({ message: "Google Sheet is empty or unreadable." });
                }

                const allSheetColumns = Object.keys(fullRowsJson[0]);

                // User ke checked columns match karein
                const finalColumnsToKeep = chosenColumns.length > 0 
                    ? chosenColumns.filter(col => allSheetColumns.includes(col))
                    : allSheetColumns;

                // 🎯 FILTERING: Only extract checked columns data
                const filteredRowsData = fullRowsJson.map(row => {
                    let filteredRow = {};
                    finalColumnsToKeep.forEach(col => {
                        if (row[col] !== undefined) {
                            filteredRow[col] = row[col];
                        }
                    });
                    return filteredRow;
                });

                const tablesData = [{
                    tableName: "Sheet1_Data",
                    columns: finalColumnsToKeep,
                    rowsData: filteredRowsData
                }];

                const newSetup = await DatabaseSetup.create({
                    userId,
                    dbName: `GoogleSheet_${sheetId.substring(0, 8)}`,
                    host: "Live Google Sheet",
                    user: req.user.name || "User",
                    tables: tablesData,
                    totalTablesCount: 1
                });

                return res.status(200).json({
                    message: "Google Sheet Selected Columns Successfully Saved to Profile!",
                    setupId: newSetup._id,
                    savedData: newSetup
                });

            } catch (err) {
                console.error("Google Sheet Sync Error:", err.message);
                return res.status(500).json({ 
                    message: "Failed to download Google Sheet. Make sure Sheet Access is set to 'Anyone with the link can view'." 
                });
            }
        }

        // 🟢 3. Agar SQL Database connect kiya gaya hai
        if (!chosenColumns || chosenColumns.length === 0) {
            return res.status(400).json({ message: "Select at least one table." });
        }

        connection = await mysql.createConnection({
            host, port: Number(port) || 3306, user, password: password || '', database
        });

        const tablesData = [];

        for (const table of chosenColumns) {
            const [rows] = await connection.query(`SELECT * FROM \`${table}\` LIMIT 500;`);
            const [columnsRaw] = await connection.query(`DESCRIBE \`${table}\`;`);
            const columns = columnsRaw.map(col => col.Field);

            tablesData.push({
                tableName: table,
                columns: columns,
                rowsData: rows
            });
        }

        const newSetup = await DatabaseSetup.create({
            userId,
            dbName: database,
            host,
            user,
            tables: tablesData,
            totalTablesCount: tablesData.length
        });

        return res.status(200).json({
            message: "SQL Database Setup Saved Successfully!",
            setupId: newSetup._id,
            savedData: newSetup
        });

    } catch (error) {
        console.error("Sync Error:", error);
        return res.status(500).json({ message: `Sync Failed: ${error.message}` });
    } finally {
        if (connection) await connection.end();
    }
};

// 4. Fetch Recent Saved Setups (Strictly User Specific)
const getRecentSetups = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access." });
        }

        const recentSetups = await DatabaseSetup.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10);
        return res.status(200).json({ setups: recentSetups });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

// 5. Fetch Dashboard Stats (Strictly User Specific)
const getDashboardStats = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized access." });
        }
        const userId = req.user.id;
        const totalDatabases = await DatabaseSetup.distinct("dbName", { userId });
        const allSetups = await DatabaseSetup.find({ userId });
        
        let totalTables = 0;
        let totalRows = 0;

        allSetups.forEach(setup => {
            setup.tables.forEach(t => {
                totalTables += 1;
                totalRows += (t.rowsData ? t.rowsData.length : 0);
            });
        });

        const mostUsed = totalDatabases.length > 0 ? totalDatabases[0] : "N/A";

        return res.status(200).json({
            totalDatabasesCount: totalDatabases.length,
            totalTablesCount: totalTables,
            totalSyncedRows: totalRows,
            mostUsedDB: mostUsed,
            recentActivity: allSetups.slice(0, 5)
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

// 6. AI Agent Chat
const handleAgentChat = async (req, res) => {
    try {
        const { query, databaseContext } = req.body;

        let systemContext = "You are a professional SQL and Data Analysis Assistant.";
        if (databaseContext) {
            systemContext += ` Active Selected DB: ${databaseContext.dbName}. Tables Context: ${JSON.stringify(databaseContext.tablesSummary || {})}`;
        }

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemContext },
                { role: "user", content: query }
            ],
            model: "llama-3.3-70b-versatile"
        });

        return res.status(200).json({ reply: chatCompletion.choices[0]?.message?.content || "No response." });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};
// Helper Function ha Bro
// Helper Function (Fixed with Buffer Support)
async function getSheetColumns(file, googleSheetUrl) {
    let workbook;
    let sourceName = "Sheet_Source";

    if (file) {
        // 🟢 Fix: Read from memory buffer instead of disk path
        if (file.buffer) {
            workbook = xlsx.read(file.buffer, { type: 'buffer' });
        } else if (file.path) {
            workbook = xlsx.readFile(file.path);
        } else {
            throw new Error("File content could not be read.");
        }
        sourceName = file.originalname;
    } else if (googleSheetUrl) {
        // Convert Google Sheet edit link to CSV Export Link
        const matches = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!matches) throw new Error("Invalid Google Sheet URL format.");
        
        const sheetId = matches[1];
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        
        const response = await axios.get(csvUrl, { responseType: 'arraybuffer' });
        workbook = xlsx.read(response.data, { type: 'buffer' });
        sourceName = "Google_Sheet";
    } else {
        throw new Error("Neither Excel file nor Google Sheet URL was provided.");
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const columns = jsonData.length > 0 ? jsonData[0] : [];
    return { columns, sourceName, workbook, sheetName };
}
const handleFetchdata = async(req,res) =>{
    try {
        const googleSheetUrl = req.body.googleSheetUrl;
        const file = req.file;

        const { columns, sourceName } = await getSheetColumns(file, googleSheetUrl);
        return res.status(200).json({ success: true, columns, sourceName });
    } catch (err) {
        console.error("Fetch Sheet Columns Error:", err);
        return res.status(400).json({ success: false, message: err.message || "Failed to parse sheet" });
    }
}

const chat_analytics = async(req,res)=>{
    try {
            const { agentId } = req.params;
            const logs = await ChatLog.find({ agentId }).sort({ createdAt: -1 });
    
            const totalChats = logs.length;
            const totalDuration = logs.reduce((acc, curr) => acc + curr.chatDurationSeconds, 0);
            const avgDurationSeconds = totalChats > 0 ? Math.round(totalDuration / totalChats) : 0;
    
            return res.status(200).json({
                success: true,
                totalChats,
                avgDurationMinutes: (avgDurationSeconds / 60).toFixed(1),
                sessions: logs
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
    }
}
const getLeadHistoryByVisitor = async (req, res) => {
    try {
        const { visitorId } = req.params;

        const lead = await VisitorLead.findOne({ visitorId });
        
        if (!lead) {
            return res.status(404).json({ success: false, message: "No history found for this visitor." });
        }

        return res.status(200).json({ success: true, lead });
    } catch (err) {
        console.error("Lead History Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

const planUpgradeFunc = async(req,res)=>{
    try {
        const { requestedPlan } = req.body; // 'basic', 'silver', 'golden'
        const userId = req.user.id; // Assuming auth middleware provides req.user

        if (!['basic', 'silver', 'golden'].includes(requestedPlan)) {
            return res.status(400).json({ success: false, message: "Invalid plan selected." });
        }

        // Find agent belonging to this user
        const agent = await AgentSetup.findOne({ userId });
        if (!agent) {
            return res.status(404).json({ success: false, message: "AI Agent not found for this profile." });
        }

        if (agent.planStatus === 'pending_approval') {
            return res.status(400).json({ 
                success: false, 
                message: "⚠️ Aapka ek plan upgrade request pehle se hi admin approval ke liye pending hai. Aap naya plan khareedne se pehle current request ke approve hone ka wait karein." 
            });
        }

        // Generate a dummy transaction ID for tracking
        const txnId = 'TXN_NWEB_' + Math.floor(100000 + Math.random() * 900000);

        // Update agent status to pending approval
        agent.planStatus = 'pending_approval';
        agent.pendingPaymentDetails = {
            transactionId: txnId,
            requestedPlan: requestedPlan,
            submittedAt: new Date()
        };

        await agent.save();

        return res.status(200).json({
            success: true,
            message: "Upgrade request submitted successfully. Waiting for admin approval.",
            transactionId: txnId
        });
    } catch (err) {
        console.error("Plan Upgrade Request Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

const approvedPlanFunc = async (req,res)=>{
try {
        const { agentId } = req.params;
        const agent = await AgentSetup.findById(agentId);

        if (!agent) {
            return res.status(404).json({ success: false, message: "Agent not found." });
        }

        const requestedPlan = agent.pendingPaymentDetails?.requestedPlan || 'basic';
        const now = new Date();

        // Configure limits based on plan type
        agent.planType = requestedPlan;
        agent.planStatus = 'active';
        agent.messagesUsed = 0; // Reset usage counter on upgrade

        if (requestedPlan === 'basic') {
            agent.usageLimit = 500;
        } else if (requestedPlan === 'silver') {
            agent.usageLimit = 3000;
        } else if (requestedPlan === 'golden') {
            agent.usageLimit = 999999; // Unlimited / Fair use
            // Set 1 Month Expiry for Golden Plan
            const oneMonthLater = new Date();
            oneMonthLater.setMonth(now.getMonth() + 1);
            agent.planStartDate = now;
            agent.planEndDate = oneMonthLater;
        }

        // Clear pending details
        agent.pendingPaymentDetails = undefined;
        await agent.save();

        return res.status(200).json({
            success: true,
            message: `Plan successfully approved and upgraded to ${requestedPlan.toUpperCase()}!`
        });
    } catch (err) {
        console.error("Admin Approval Error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { connectDatabase,approvedPlanFunc,planUpgradeFunc,getLeadHistoryByVisitor,chat_analytics, handleAgentChat, saveDatabaseSetup, getDashboardStats, getRecentSetups, fetchDatabases, fetchTables, handleFetchdata };