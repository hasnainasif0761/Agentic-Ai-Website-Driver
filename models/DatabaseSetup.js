const mongoose = require('mongoose');

const DatabaseSetupSchema = new mongoose.Schema({
    dbName: { type: String, required: true },
    host: { type: String, required: true },
    user: { type: String, required: true },
    tables: [{
        tableName: { type: String, required: true },
        columns: [String],
        rowsData: [mongoose.Schema.Types.Mixed] // Flexible array to store complete table row data
    }],
    totalTablesCount: { type: Number, default: 0 },
    status: { type: String, default: 'Synced' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DatabaseSetup', DatabaseSetupSchema);