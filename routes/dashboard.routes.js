const express = require('express');
const { connectDatabase,saveDatabaseSetup,visitor_chat,approvedPlanFunc,planUpgradeFunc,getRecentSetups,getLeadHistoryByVisitor,chat_analytics,getDashboardStats,handleFetchdata, handleAgentChat,fetchDatabases, fetchTables } = require('../controller/dashboard.controller');
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
router.post('/fetch-sheet-columns', upload.single('excelFile'),handleFetchdata);
router.get('/chat-analytics/:agentId',chat_analytics)
router.get('/lead-history/:visitorId', authMiddleware, getLeadHistoryByVisitor);
router.post('/request-plan-upgrade',authMiddleware,planUpgradeFunc)
router.post('/admin/approve-plan/:agentId',approvedPlanFunc)
router.get('/visitor-chats/:visitorId',visitor_chat)

module.exports = router;