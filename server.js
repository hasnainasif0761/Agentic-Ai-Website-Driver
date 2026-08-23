require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());

// Public folder se static html/css/js serve karein
app.use(express.static(path.join(__dirname, 'public')));

// Fallback Route for Frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Python AI Agent EndPoint URL
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://127.0.0.1:8000/api/agent';

// Socket.io Real-time Communication
io.on('connection', (socket) => {
  console.log(`⚡ New Client Connected: ${socket.id}`);

  // User ka voice/chat text event handle karein
  socket.on('user_speak', async (data) => {
    try {
      console.log(`[User Said - ${socket.id}]:`, data.text);

      // Python FastAPI Agent ko user input forward karein
      const pythonResponse = await axios.post(PYTHON_AGENT_URL, {
        user_id: socket.id,
        text: data.text
      });

      const agentResult = pythonResponse.data;
      console.log(`[Python Reply - ${socket.id}]:`, agentResult.reply);

      // Python ka reply Frontend Widget par bhej dein
      socket.emit('agent_reply', agentResult);

    } catch (error) {
      console.error('❌ Error communicating with Python Agent:', error.message);
      
      // Fallback message agar Python server down ho
      socket.emit('agent_reply', {
        reply: "Maazrat, mera AI engine abhi connect nahi ho pa raha. Kripya thodi der baad koshish karein.",
        step: "error"
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client Disconnected: ${socket.id}`);
  });
});

// Express Server Port
const PORT = 5000;
server.listen(PORT, () => {
  console.log(`🚀 Node.js Gateway Server running on http://localhost:${PORT}`);
});