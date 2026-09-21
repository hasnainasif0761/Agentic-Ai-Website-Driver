const express = require('express');
const { connectDatabase,saveDatabaseSetup,getRecentSetups,getDashboardStats, handleAgentChat,fetchDatabases, fetchTables } = require('../controller/dashboard.controller');

const router = express.Router();

router.post('/connect-db', connectDatabase);
router.post('/chat-agent', handleAgentChat);
router.post('/fetch-databases', fetchDatabases);
router.post('/fetch-tables', fetchTables);
router.post('/save-setup', saveDatabaseSetup);
router.get('/recent-setups', getRecentSetups);
router.get('/stats', getDashboardStats);

module.exports = router;