const express = require('express');
const { connectDatabase,saveDatabaseSetup,getRecentSetups,getDashboardStats, handleAgentChat,fetchDatabases, fetchTables } = require('../controller/dashboard.controller');
const { authMiddleware } = require('../middleware/authMiddleware');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/connect-db', connectDatabase);
router.post('/chat-agent', handleAgentChat);
router.post('/fetch-databases', fetchDatabases);
router.post('/fetch-tables', fetchTables);
router.post('/save-setup',authMiddleware,upload.single('excelFile'), saveDatabaseSetup);
router.get('/recent-setups',authMiddleware, getRecentSetups);
router.get('/stats',authMiddleware, getDashboardStats);

module.exports = router;