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
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized access. Please login first." });
        }

        const {
            host,
            port,
            user,
            password,
            database,
            dataSourceType,
            googleSheetUrl,
            dbName
        } = req.body;

        // Normalize selectedTables / selectedColumns / selectedTabs
        let parsedSelection = [];
        const rawSelection = req.body.selectedTables || req.body.selectedTabs || req.body.selectedColumns;

        if (rawSelection) {
            if (Array.isArray(rawSelection)) {
                parsedSelection = rawSelection;
            } else if (typeof rawSelection === 'string') {
                try {
                    parsedSelection = JSON.parse(rawSelection);
                } catch (e) {
                    parsedSelection = [rawSelection];
                }
            }
        }

        // Agar frontend ne pre-parsed tab objects bheje hain (e.g. [{ tableName, tableRole, columns, rowsData }])
        const hasDetailedTabObjects =
            Array.isArray(parsedSelection) &&
            parsedSelection.length > 0 &&
            typeof parsedSelection[0] === 'object' &&
            parsedSelection[0] !== null &&
            (parsedSelection[0].tableName || parsedSelection[0].sheetName);

        // 1. Agar EXCEL FILE upload hui hai
        if (req.file) {
            if (hasDetailedTabObjects) {
                const tablesData = parsedSelection.map((t) => ({
                    tableName: String(t.tableName || t.sheetName || 'Sheet').trim(),
                    tableRole: String(t.tableRole || '').trim(),
                    columns: Array.isArray(t.columns) ? t.columns : [],
                    rowsData: Array.isArray(t.rowsData) ? t.rowsData : []
                }));

                if (tablesData.length === 0) {
                    return res.status(400).json({ message: "No valid tabs selected from Excel file." });
                }

                const newSetup = await DatabaseSetup.create({
                    userId,
                    dbName: (dbName && dbName.trim()) || req.file.originalname,
                    host: "Uploaded Excel File",
                    user: req.user.name || "User",
                    sourceType: "excel",
                    lastSyncedAt: new Date(),
                    tables: tablesData,
                    totalTablesCount: tablesData.length
                });

                return res.status(200).json({
                    success: true,
                    message: `${tablesData.length} Excel tab(s) saved to User Profile!`,
                    setupId: newSetup._id,
                    savedData: newSetup
                });
            }

            const { workbook } = await loadSpreadsheetWorkbook({ file: req.file });
            const allSheets = extractAllSheetsFromWorkbook(workbook);

            const selectedTabNames = parsedSelection
                .filter((item) => typeof item === 'string')
                .map((s) => s.trim().toLowerCase());

            const targetSheets =
                selectedTabNames.length > 0
                    ? allSheets.filter((s) => selectedTabNames.includes(s.sheetName.toLowerCase()))
                    : allSheets;

            const tablesData = targetSheets.map((sheet) => ({
                tableName: sheet.sheetName,
                tableRole: "",
                columns: sheet.columns,
                rowsData: sheet.rowsData
            }));

            if (tablesData.length === 0) {
                return res.status(400).json({ message: "Uploaded Excel sheet is empty or no matching tabs found." });
            }

            const newSetup = await DatabaseSetup.create({
                userId,
                dbName: (dbName && dbName.trim()) || req.file.originalname,
                host: "Uploaded Excel File",
                user: req.user.name || "User",
                sourceType: "excel",
                lastSyncedAt: new Date(),
                tables: tablesData,
                totalTablesCount: tablesData.length
            });

            return res.status(200).json({
                success: true,
                message: `Excel (${tablesData.length} tab(s)) successfully parsed & saved to User Profile!`,
                setupId: newSetup._id,
                savedData: newSetup
            });
        }

        // 2. Agar GOOGLE SHEET URL hai (Multi-Tab Support)
        if (dataSourceType === 'googlesheet' || dataSourceType === 'google_sheet' || googleSheetUrl) {
            try {
                if (hasDetailedTabObjects) {
                    const tablesData = parsedSelection.map((t) => ({
                        tableName: String(t.tableName || t.sheetName || 'Sheet').trim(),
                        tableRole: String(t.tableRole || '').trim(),
                        columns: Array.isArray(t.columns) ? t.columns : [],
                        rowsData: Array.isArray(t.rowsData) ? t.rowsData : []
                    }));

                    if (tablesData.length === 0) {
                        return res.status(400).json({ message: "Please select at least one Google Sheet tab." });
                    }

                    const match = String(googleSheetUrl || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                    const sheetId = match ? match[1] : null;

                    const newSetup = await DatabaseSetup.create({
                        userId,
                        dbName: (dbName && dbName.trim()) || (sheetId ? `GoogleSheet_${sheetId.substring(0, 8)}` : "Google Sheet"),
                        host: "Live Google Sheet",
                        user: req.user.name || "User",
                        sourceType: "google_sheet",
                        sourceUrl: String(googleSheetUrl || '').trim(),
                        sheetId,
                        lastSyncedAt: new Date(),
                        tables: tablesData,
                        totalTablesCount: tablesData.length
                    });

                    return res.status(200).json({
                        success: true,
                        message: `${tablesData.length} Google Sheet tab(s) saved to profile!`,
                        setupId: newSetup._id,
                        savedData: newSetup
                    });
                }

                const { sourceName, sheetId, workbook } = await loadSpreadsheetWorkbook({ googleSheetUrl });
                const allSheets = extractAllSheetsFromWorkbook(workbook);

                if (!allSheets.length) {
                    return res.status(400).json({ message: "Google Sheet is empty or unreadable." });
                }

                const selectedTabNames = parsedSelection
                    .filter((item) => typeof item === 'string')
                    .map((s) => s.trim().toLowerCase());

                const targetSheets =
                    selectedTabNames.length > 0
                        ? allSheets.filter((s) => selectedTabNames.includes(s.sheetName.toLowerCase()))
                        : allSheets;

                const tablesData = targetSheets.map((sheet) => ({
                    tableName: sheet.sheetName,
                    tableRole: "",
                    columns: sheet.columns,
                    rowsData: sheet.rowsData
                }));

                if (tablesData.length === 0) {
                    return res.status(400).json({ message: "No matching sheet tabs found in Google Sheet." });
                }

                const newSetup = await DatabaseSetup.create({
                    userId,
                    dbName: (dbName && dbName.trim()) || sourceName,
                    host: "Live Google Sheet",
                    user: req.user.name || "User",
                    sourceType: "google_sheet",
                    sourceUrl: String(googleSheetUrl || '').trim(),
                    sheetId,
                    lastSyncedAt: new Date(),
                    tables: tablesData,
                    totalTablesCount: tablesData.length
                });

                return res.status(200).json({
                    success: true,
                    message: `Google Sheet (${tablesData.length} tab(s)) successfully saved to profile!`,
                    setupId: newSetup._id,
                    savedData: newSetup
                });
            } catch (err) {
                console.error("Google Sheet Sync Error:", err.response?.data || err.message);
                return res.status(400).json({
                    message: "Failed to download Google Sheet. Make sure Sheet Access is set to 'Anyone with the link can view'."
                });
            }
        }

        // 3. Agar SQL DATABASE connect kiya gaya hai
        const sqlTables = parsedSelection.filter((item) => typeof item === 'string');
        if (!sqlTables || sqlTables.length === 0) {
            return res.status(400).json({ message: "Select at least one table." });
        }

        connection = await mysql.createConnection({
            host,
            port: Number(port) || 3306,
            user,
            password: password || '',
            database
        });

        const tablesData = [];
        for (const table of sqlTables) {
            const [rows] = await connection.query(`SELECT * FROM \`${table}\` LIMIT 500;`);
            const [columnsRaw] = await connection.query(`DESCRIBE \`${table}\`;`);
            const columns = columnsRaw.map((col) => col.Field);

            tablesData.push({
                tableName: table,
                tableRole: "",
                columns,
                rowsData: rows
            });
        }

        const newSetup = await DatabaseSetup.create({
            userId,
            dbName: (dbName && dbName.trim()) || database,
            host,
            user,
            sourceType: "mysql",
            lastSyncedAt: new Date(),
            tables: tablesData,
            totalTablesCount: tablesData.length
        });

        return res.status(200).json({
            success: true,
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

        const agent = await AgentSetup.findOne({ userId });
        
        return res.status(200).json({
            totalDatabasesCount: totalDatabases.length,
            totalTablesCount: totalTables,
            totalSyncedRows: totalRows,
            mostUsedDB: mostUsed,
            recentActivity: allSetups.slice(0, 5),
            agent: agent || null
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

const visitor_chat = async(req,res)=>{
    try {
                const { visitorId } = req.params;
                
                // 🟢 Check both primary visitorId and linked visitorIds array
                const lead = await VisitorLead.findOne({ 
                    $or: [
                        { visitorId: visitorId },
                        { visitorIds: visitorId }
                    ] 
                });
                
                if (!lead || !lead.chatHistory || lead.chatHistory.length === 0) {
                    return res.status(200).json({ success: true, chatHistory: [] });
                }
        
                return res.status(200).json({ success: true, chatHistory: lead.chatHistory });
            } catch (err) {
                return res.status(500).json({ success: false, message: err.message });
            }
}

function extractAllSheetsFromWorkbook(workbook) {
    const sheets = [];

    for (const sheetName of workbook.SheetNames || []) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;

        const jsonRows = xlsx.utils.sheet_to_json(worksheet, { defval: '', raw: false });
        const nonEmptyRows = jsonRows.filter((row) =>
            Object.values(row).some((val) => String(val ?? '').trim() !== '')
        );

        const headerMatrix = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
        const firstRowCols = Array.isArray(headerMatrix[0])
            ? headerMatrix[0].map((c) => String(c ?? '').trim()).filter(Boolean)
            : [];

        const inferredCols =
            nonEmptyRows.length > 0
                ? Object.keys(nonEmptyRows[0]).map((k) => String(k).trim()).filter(Boolean)
                : [];

        const columns = Array.from(new Set([...firstRowCols, ...inferredCols]));

        const cleanedRows = nonEmptyRows.map((row) => {
            const item = {};
            for (const col of columns) {
                item[col] = row[col] !== undefined ? row[col] : '';
            }
            return item;
        });

        sheets.push({
            sheetName: String(sheetName).trim(),
            columns,
            rowsData: cleanedRows,
            rowCount: cleanedRows.length
        });
    }

    return sheets;
}

const inspectSpreadsheetTabs = async (req, res) => {
    try {
        const googleSheetUrl = req.body?.googleSheetUrl;
        const file = req.file;

        const { sourceName, sheetId, workbook } = await loadSpreadsheetWorkbook({
            file,
            googleSheetUrl
        });

        const sheets = extractAllSheetsFromWorkbook(workbook);

        if (!sheets.length) {
            return res.status(400).json({
                success: false,
                message: "No worksheet tabs found in this spreadsheet."
            });
        }

        return res.status(200).json({
            success: true,
            sourceName,
            sheetId,
            sheets
        });
    } catch (err) {
        console.error("Inspect Spreadsheet Tabs Error:", err.response?.data || err.message);
        if (err.response?.status === 401 || err.response?.status === 403 || err.response?.status === 404) {
            return res.status(400).json({
                success: false,
                message: "Google Sheet access denied or not found. Make sure Sheet sharing is set to 'Anyone with the link can view'."
            });
        }
        return res.status(400).json({
            success: false,
            message: err.message || "Failed to inspect spreadsheet tabs."
        });
    }
};

async function loadSpreadsheetWorkbook({ file, googleSheetUrl }) {
    if (file) {
        if (file.buffer) {
            return {
                sourceName: file.originalname || 'Uploaded_Excel',
                sheetId: null,
                workbook: xlsx.read(file.buffer, { type: 'buffer' })
            };
        }
        if (file.path) {
            return {
                sourceName: file.originalname || 'Uploaded_Excel',
                sheetId: null,
                workbook: xlsx.readFile(file.path)
            };
        }
        throw new Error("Uploaded Excel file content could not be read.");
    }

    if (googleSheetUrl) {
        const match = String(googleSheetUrl).trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!match || !match[1]) {
            throw new Error("Invalid Google Sheet URL format.");
        }

        const sheetId = match[1];
        // XLSX export use karne se saari sheet tabs aati hain (CSV sirf pehli tab deta hai)
        const xlsxExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
        const response = await axios.get(xlsxExportUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        return {
            sourceName: `GoogleSheet_${sheetId.substring(0, 8)}`,
            sheetId,
            workbook: xlsx.read(Buffer.from(response.data), { type: 'buffer' })
        };
    }

    throw new Error("Please provide a Google Sheet URL or upload an Excel file.");
}

module.exports = { connectDatabase,visitor_chat,approvedPlanFunc,planUpgradeFunc,getLeadHistoryByVisitor,chat_analytics, handleAgentChat, saveDatabaseSetup, getDashboardStats, getRecentSetups, fetchDatabases, fetchTables, handleFetchdata, inspectSpreadsheetTabs };