const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware'); // Middleware check
const { saveOrUpdateAgent, getUserAgent } = require('../controller/agent.controller');

const Agentrouter = express.Router();

Agentrouter.post('/save-agent',authMiddleware,saveOrUpdateAgent);
Agentrouter.get('/get-agent',authMiddleware,getUserAgent);

module.exports = Agentrouter


