const mysql = require('mysql2/promise');
const Groq = require("groq-sdk");
const DatabaseSetup = require('../models/DatabaseSetup'); 
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const axios = require('axios');

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
        const { host, port, user, password, database, selectedTables, dataSourceType, googleSheetUrl } = req.body;

        // 1. Agar User ne EXCEL FILE Upload ki hai (req.file exist karta hai)
        if (req.file) {
            // Memory Buffer se Excel file read karein
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const tablesData = [];

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                // Excel Sheet ko JSON Objects Array mein convert karein
                const rowsJson = xlsx.utils.sheet_to_json(sheet);

                if (rowsJson.length > 0) {
                    // Dynamic Columns (Employee Salary Sheet ke actual Headers)
                    const columns = Object.keys(rowsJson[0]);

                    tablesData.push({
                        tableName: sheetName,
                        columns: columns,
                        rowsData: rowsJson
                    });
                }
            });

            if (tablesData.length === 0) {
                return res.status(400).json({ message: "Uploaded Excel sheet is empty." });
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
                message: "Excel File Data Successfully Parsed & Saved to MongoDB!",
                setupId: newSetup._id,
                savedData: newSetup
            });
        }

        // 2. Agar Google Sheet URL hai (Handling)
        // controllers/dashboard.controller.js -> saveDatabaseSetup function ke andar:

if (dataSourceType === 'googlesheet' && googleSheetUrl) {
    try {
        // 1. Spreadsheet ID extract karein URL me se
        const match = googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        
        if (!match || !match[1]) {
            return res.status(400).json({ message: "Invalid Google Sheet URL format." });
        }

        const sheetId = match[1];
        // Direct CSV export link format
        const csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

        // 2. Fetch CSV Data from Google
        const response = await axios.get(csvExportUrl, { 
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        // 3. Parse CSV data using XLSX library
        const workbook = xlsx.read(response.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rowsJson = xlsx.utils.sheet_to_json(sheet);

        if (!rowsJson || rowsJson.length === 0) {
            return res.status(400).json({ message: "Google Sheet is empty or unreadable." });
        }

        // Dynamically extract columns from the first row
        const columns = Object.keys(rowsJson[0]);

        const tablesData = [{
            tableName: "Sheet1_Data",
            columns: columns,
            rowsData: rowsJson
        }];

        // 4. Save isolated data to MongoDB
        const newSetup = await DatabaseSetup.create({
            userId,
            dbName: `GoogleSheet_${sheetId.substring(0, 8)}`,
            host: "Live Google Sheet",
            user: req.user.name || "User",
            tables: tablesData,
            totalTablesCount: 1
        });

        return res.status(200).json({
            message: "Google Sheet Data Successfully Parsed & Saved to User Profile!",
            setupId: newSetup._id,
            savedData: newSetup
        });

    } catch (err) {
        console.error("Google Sheet Sync Error:", err.message);
        return res.status(500).json({ 
            message: "Failed to download Google Sheet. Make sure the Sheet Access is set to 'Anyone with the link can view'." 
        });
    }
}

        // 3. Agar SQL Server Database hai
        if (!selectedTables || selectedTables.length === 0) {
            return res.status(400).json({ message: "Select at least one table." });
        }

        connection = await mysql.createConnection({
            host, port: Number(port) || 3306, user, password: password || '', database
        });

        const tablesData = [];

        for (const table of selectedTables) {
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

module.exports = { connectDatabase, handleAgentChat, saveDatabaseSetup, getDashboardStats, getRecentSetups, fetchDatabases, fetchTables };