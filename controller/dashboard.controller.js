const mysql = require('mysql2/promise');
const Groq = require("groq-sdk");
const DatabaseSetup = require('../models/DatabaseSetup'); 
const fs = require('fs');
const path = require('path');

// Database connection and table fetch handler
const connectDatabase = async (req, res) => {
    try {
        const { host, port, user, password, database } = req.body;

        if (!host || !user || !database) {
            return res.status(400).json({ message: "Host, user, and database fields are required." });
        }

        // Yahan aap live ya local MySQL/PostgreSQL connection establish kar sakte hain.
        // Mocking table fetch response:
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



const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

// 3. Save Selected Database & Tables with full Rows & Columns data to MongoDB
// 3. Save Selected Database & Tables with full Rows & Columns data
const saveDatabaseSetup = async (req, res) => {
    let connection;
    try {
        const { host, port, user, password, database, selectedTables } = req.body;

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

        // 1. Save or update in MongoDB
        const newSetup = await DatabaseSetup.create({
            dbName: database,
            host,
            user,
            tables: tablesData,
            totalTablesCount: tablesData.length
        });

        // 2. [FIX] Write to active_sql_context.json for Python Agent!
        const selectedTablesObj = {};
        selectedTablesObj[database] = selectedTables;

        const activeConfig = {
            host: host,
            port: Number(port) || 3306,
            user: user,
            password: password || '',
            selected_dbs: [database],
            selected_tables: selectedTablesObj
        };

        const configPath = path.join(__dirname, '../active_sql_context.json'); // Apne path ke hisab se adjust karein
        fs.writeFileSync(configPath, JSON.stringify(activeConfig, null, 4));

        console.log("[CONTEXT UPDATED] active_sql_context.json file created successfully!");

        return res.status(200).json({
            message: "Database & Table Structure synced to MongoDB and Python Context File!",
            setupId: newSetup._id,
            savedData: newSetup
        });

    } catch (error) {
        return res.status(500).json({ message: `Sync Failed: ${error.message}` });
    } finally {
        if (connection) await connection.end();
    }
};

// 4. Fetch Recent Saved Setups for View Tab
const getRecentSetups = async (req, res) => {
    try {
        const recentSetups = await DatabaseSetup.find().sort({ createdAt: -1 }).limit(10);
        return res.status(200).json({ setups: recentSetups });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

// 5. Fetch Dashboard Overview Statistics
const getDashboardStats = async (req, res) => {
    try {
        const totalDatabases = await DatabaseSetup.distinct("dbName");
        const allSetups = await DatabaseSetup.find();
        
        let totalTables = 0;
        let totalRows = 0;

        allSetups.forEach(setup => {
            setup.tables.forEach(t => {
                totalTables += 1;
                totalRows += (t.rowsData ? t.rowsData.length : 0);
            });
        });

        // Find Most Used Database
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

// 6. AI Agent Chat with full Schema & Local Context
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


module.exports = { connectDatabase, handleAgentChat ,saveDatabaseSetup, getDashboardStats, getRecentSetups, fetchDatabases, fetchTables};