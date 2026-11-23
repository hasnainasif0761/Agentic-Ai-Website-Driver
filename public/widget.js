(function () {
    const currentScript = document.currentScript || (function() {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    const agentId = currentScript ? currentScript.getAttribute('data-agent-id') : null;

    if (!agentId) {
        console.error('[NWeb AI Widget] Error: data-agent-id attribute is missing.');
        return;
    }

    const BACKEND_URL = "https://agentic-ai-website-driver.vercel.app";

    let agentData = null;
    let activeTab = 'chat';
    let isCallActive = false;
    let recognition = null;

    // 🟢 DYNAMIC TRACKING: Unique Visitor ID
    let visitorId = localStorage.getItem('nweb_visitor_id');
    if (!visitorId) {
        visitorId = 'visitor_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('nweb_visitor_id', visitorId);
    }
    
    // 🟢 LOCALSTORAGE LEAD PROFILE (Without Chat History)
    const LEAD_STORAGE_KEY = `nweb_verified_lead_${agentId}`;
    let savedLead = null;
    try {
        const rawLead = localStorage.getItem(LEAD_STORAGE_KEY);
        if (rawLead) savedLead = JSON.parse(rawLead);
    } catch (e) {
        savedLead = null;
    }

    function saveLeadToLocalStorage(leadObj) {
        if (!leadObj) return;
        savedLead = {
            _id: leadObj._id || (savedLead && savedLead._id) || null,
            name: leadObj.name || (savedLead && savedLead.name) || '',
            email: leadObj.email || (savedLead && savedLead.email) || '',
            phone: leadObj.phone || (savedLead && savedLead.phone) || ''
        };
        localStorage.setItem(LEAD_STORAGE_KEY, JSON.stringify(savedLead));
    }
    
    const sessionStartTime = Date.now();

    // ==========================================
    // 1. CSS STYLING INJECTION
    // ==========================================
    const style = document.createElement('style');
    style.innerHTML = `
        #nweb-widget-container {
            position: fixed;
            bottom: 25px;
            right: 25px;
            z-index: 999999;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        #nweb-widget-toggle-btn {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: #00B4D8;
            color: white;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            transition: transform 0.2s ease, background 0.3s;
        }
        #nweb-widget-toggle-btn:hover {
            transform: scale(1.08);
            background: #0096C7;
        }
        #nweb-widget-box {
            display: none;
            position: absolute;
            bottom: 75px;
            right: 0;
            width: 360px;
            height: 520px;
            background: #0F162A;
            border: 1px solid #1E293B;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            flex-direction: column;
            overflow: hidden;
            color: #E2E8F0;
        }
        .nweb-header {
            background: #070B14;
            padding: 14px 18px;
            border-bottom: 1px solid #1E293B;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .nweb-title {
            font-weight: 700;
            color: #00B4D8;
            font-size: 15px;
        }
        .nweb-tabs {
            display: flex;
            background: #070B14;
            border-bottom: 1px solid #1E293B;
        }
        .nweb-tab-btn {
            flex: 1;
            padding: 10px;
            background: transparent;
            border: none;
            color: #94A3B8;
            font-weight: 600;
            cursor: pointer;
            font-size: 13px;
            transition: 0.2s;
        }
        .nweb-tab-btn.active {
            color: #00B4D8;
            border-bottom: 2px solid #00B4D8;
            background: #0F162A;
        }
        .nweb-content-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #nweb-chat-messages {
            flex: 1;
            padding: 15px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .nweb-msg {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 12px;
            font-size: 13px;
            line-height: 1.4;
        }
        .nweb-msg-user {
            align-self: flex-end;
            background: #00B4D8;
            color: #ffffff;
            border-bottom-right-radius: 2px;
        }
        .nweb-msg-bot {
            align-self: flex-start;
            background: #1E293B;
            color: #E2E8F0;
            border-bottom-left-radius: 2px;
        }
        .nweb-chat-input-area {
            padding: 12px;
            background: #070B14;
            border-top: 1px solid #1E293B;
            display: flex;
            gap: 8px;
        }
        .nweb-chat-input-area input {
            flex: 1;
            background: #0F162A;
            border: 1px solid #1E293B;
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            outline: none;
            font-size: 13px;
        }
        .nweb-chat-input-area button {
            background: #00B4D8;
            border: none;
            color: white;
            padding: 8px 14px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }
        #nweb-voice-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 20px;
            padding: 25px;
            text-align: center;
            height: 100%;
        }
        .nweb-call-btn {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            border: none;
            transition: 0.2s;
        }
        #nweb-start-call-btn {
            background: #10B981;
            color: white;
        }
        #nweb-start-call-btn:hover {
            background: #059669;
        }
        #nweb-end-call-btn {
            background: #EF4444;
            color: white;
            display: none;
        }
        #nweb-end-call-btn:hover {
            background: #DC2626;
        }
        .nweb-status-badge {
            font-size: 14px;
            font-weight: 600;
            color: #00B4D8;
            padding: 8px 16px;
            background: #070B14;
            border-radius: 20px;
            border: 1px solid #1E293B;
        }
    `;
    document.head.appendChild(style);

    // ==========================================
    // 2. WIDGET HTML STRUCTURE
    // ==========================================
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'nweb-widget-container';
    widgetContainer.innerHTML = `
        <button id="nweb-widget-toggle-btn">
           <img src="https://img.magnific.com/premium-psd/happy-robot-3d-ai-character-chat-bot-mascot-gpt-chatbot-icon-artificial-intelligence_95505-505.jpg?semt=ais_hybrid&w=740&q=80" alt="logo" width="100" style="width: 60px; border-radius: 50%;" />
        </button>
        <div id="nweb-widget-box">
            <div class="nweb-header">
                <span class="nweb-title" id="nweb-agent-name">AI Assistant</span>
                <button style="background:none; border:none; color:#94A3B8; cursor:pointer; font-size:16px;" id="nweb-close-btn">✕</button>
            </div>
            <div class="nweb-tabs">
                <button class="nweb-tab-btn active" id="nweb-tab-chat-btn">💬 Chat</button>
                <button class="nweb-tab-btn" id="nweb-tab-voice-btn">🎙️ Voice Call</button>
                <button class="nweb-tab-btn" id="nweb-tab-form-btn">📋 Form</button>
            </div>
            
            <!-- CHAT SECTION -->
            <div class="nweb-content-section" id="nweb-section-chat">
                <div id="nweb-chat-messages">
                    <div class="nweb-msg nweb-msg-bot">Hello! How can I help you today?</div>
                </div>
                <div class="nweb-chat-input-area">
                    <input type="text" id="nweb-chat-input" placeholder="Type message..." />
                    <button id="nweb-chat-send-btn">Send</button>
                </div>
            </div>

            <!-- VOICE SECTION -->
            <div class="nweb-content-section" id="nweb-section-voice" style="display:none;">
                <div id="nweb-voice-section">
                    <div class="nweb-status-badge" id="nweb-voice-status">Call Disconnected</div>
                    <p id="nweb-voice-transcript" style="font-size:13px; color:#94A3B8; min-height:40px;"></p>
                    <div style="width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: auto;">
                        <button class="nweb-call-btn" id="nweb-start-call-btn">Start Voice Call</button>
                        <button class="nweb-call-btn" id="nweb-end-call-btn">End Voice Call</button>
                    </div>
                </div>
            </div>

            <!-- FORM SECTION -->
            <div class="nweb-content-section" id="nweb-section-form" style="display:none; padding:15px;">
                <form id="nweb-lead-form" style="display:flex; flex-direction:column; gap:12px;">
                    <h4 style="color:#00B4D8; margin:0; font-size:14px;">Customer Registration</h4>
                    <input type="text" id="nweb-lead-name" placeholder="Full Name" required style="padding:10px; background:#070B14; border:1px solid #1E293B; color:white; border-radius:8px; outline:none; font-size:12px;" />
                    <input type="email" id="nweb-lead-email" placeholder="Email Address" required style="padding:10px; background:#070B14; border:1px solid #1E293B; color:white; border-radius:8px; outline:none; font-size:12px;" />
                    <input type="tel" id="nweb-lead-phone" placeholder="Phone Number" required style="padding:10px; background:#070B14; border:1px solid #1E293B; color:white; border-radius:8px; outline:none; font-size:12px;" />
                    <button type="submit" style="padding:10px; background:#00B4D8; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Register Now</button>
                    <small id="nweb-form-msg" style="font-size:11px; text-align:center;"></small>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(widgetContainer);

    // ==========================================
    // 3. DOM ELEMENTS & TAB SWITCHING LOGIC
    // ==========================================
    const toggleBtn = document.getElementById('nweb-widget-toggle-btn');
    const widgetBox = document.getElementById('nweb-widget-box');
    const closeBtn = document.getElementById('nweb-close-btn');

    const chatTabBtn = document.getElementById('nweb-tab-chat-btn');
    const voiceTabBtn = document.getElementById('nweb-tab-voice-btn');
    const formTabBtn = document.getElementById('nweb-tab-form-btn');

    const chatSection = document.getElementById('nweb-section-chat');
    const voiceSection = document.getElementById('nweb-section-voice');
    const formSection = document.getElementById('nweb-section-form');

    toggleBtn.addEventListener('click', () => {
        const isHidden = widgetBox.style.display === 'none' || widgetBox.style.display === '';
        widgetBox.style.display = isHidden ? 'flex' : 'none';
    });

    closeBtn.addEventListener('click', () => {
        widgetBox.style.display = 'none';
        if (isCallActive) endVoiceCall();
    });

    chatTabBtn.addEventListener('click', () => {
        activeTab = 'chat';
        chatTabBtn.classList.add('active');
        voiceTabBtn.classList.remove('active');
        formTabBtn.classList.remove('active');
        
        chatSection.style.display = 'flex';
        voiceSection.style.display = 'none';
        formSection.style.display = 'none';
    });

    voiceTabBtn.addEventListener('click', () => {
        activeTab = 'voice';
        voiceTabBtn.classList.add('active');
        chatTabBtn.classList.remove('active');
        formTabBtn.classList.remove('active');
        
        voiceSection.style.display = 'flex';
        chatSection.style.display = 'none';
        formSection.style.display = 'none';
    });

    if (formTabBtn) {
        formTabBtn.addEventListener('click', () => {
            activeTab = 'form';
            formTabBtn.classList.add('active');
            chatTabBtn.classList.remove('active');
            voiceTabBtn.classList.remove('active');
            
            formSection.style.display = 'flex';
            chatSection.style.display = 'none';
            voiceSection.style.display = 'none';
        });
    }

    // ==========================================
    // 4. API CALLS (AGENT DATA & CHAT REPLY)
    // ==========================================
    async function fetchAgentData() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/public/agent/${agentId}`);
            if (!res.ok) throw new Error("Agent fetch failed");
            const data = await res.json();
            if (data.success && data.agent) {
                agentData = data.agent;
                document.getElementById('nweb-agent-name').innerText = agentData.agentName || 'AI Assistant';
            }
        } catch (err) {
            console.error('[NWeb Widget] Could not fetch agent settings:', err);
        }
    }
    fetchAgentData();

    async function fetchAIReply(userText) {
        try {
            const currentDurationSeconds = Math.round((Date.now() - sessionStartTime) / 1000);
            const res = await fetch(`${BACKEND_URL}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    agentId: agentId, 
                    message: userText,
                    visitorId: visitorId,
                    // 🟢 Har chat ke sath localStorage se lead details bhejein
                    leadId: savedLead ? savedLead._id : null,
                    name: savedLead ? savedLead.name : '',
                    email: savedLead ? savedLead.email : '',
                    phone: savedLead ? savedLead.phone : '',
                    duration: currentDurationSeconds 
                })
            });
            const data = await res.json();
            
            // 🟢 Agar backend ne lead verify/update ki hai toh usay localStorage mein save karein
            if (data && data.lead) {
                saveLeadToLocalStorage(data.lead);
            }

            if (data && data.reply) {
                return data.reply;
            }
        } catch (err) {
            console.error("Fetch AI Reply Error:", err);
        }
        return null;
    }

    // ==========================================
    // 5. CHAT FUNCTIONALITY
    // ==========================================
    async function handleChatSend() {
        const input = document.getElementById('nweb-chat-input');
        const userText = input.value.trim();
        if (!userText) return;

        appendMessage(userText, 'user');
        input.value = '';

        const reply = await fetchAIReply(userText);
        if (reply) {
            appendMessage(reply, 'bot');
        } else {
            appendMessage('Error processing request', 'bot');
        }
    }

    function appendMessage(text, sender) {
        const msgContainer = document.getElementById('nweb-chat-messages');
        const div = document.createElement('div');
        div.className = `nweb-msg ${sender === 'user' ? 'nweb-msg-user' : 'nweb-msg-bot'}`;
        div.innerText = text;
        msgContainer.appendChild(div);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    document.getElementById('nweb-chat-send-btn').addEventListener('click', handleChatSend);
    document.getElementById('nweb-chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleChatSend();
    });

    // ==========================================
    // 6. VOICE CALL FUNCTIONALITY
    // ==========================================
    const startCallBtn = document.getElementById('nweb-start-call-btn');
    const endCallBtn = document.getElementById('nweb-end-call-btn');
    const voiceStatus = document.getElementById('nweb-voice-status');
    const voiceTranscript = document.getElementById('nweb-voice-transcript');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    startCallBtn.addEventListener('click', () => {
        if (!SpeechRecognition) {
            alert("Speech recognition is not supported in this browser.");
            return;
        }
        isCallActive = true;
        startCallBtn.style.display = 'none';
        endCallBtn.style.display = 'block';
        startListeningCycle();
    });

    endCallBtn.addEventListener('click', () => {
        endVoiceCall();
    });

    function endVoiceCall() {
        isCallActive = false;
        if (recognition) {
            try { recognition.abort(); } catch(e) {}
        }
        window.speechSynthesis.cancel();
        startCallBtn.style.display = 'block';
        endCallBtn.style.display = 'none';
        voiceStatus.innerText = "Call Disconnected";
        voiceTranscript.innerText = "";
    }

    function startListeningCycle() {
        if (!isCallActive) return;

        if (recognition) {
            try { recognition.abort(); } catch(e) {}
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        voiceStatus.innerText = "Please listen... (User speaking)";
        voiceTranscript.innerText = "Listening to your voice...";

        let finalTranscript = '';
        let isProcessing = false;

        recognition.onresult = (event) => {
            if (isProcessing) return;
            
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }

            if (interim) {
                voiceTranscript.innerText = `You: "${interim}"`;
            }

            if (finalTranscript.trim().length > 0 && !isProcessing) {
                isProcessing = true;
                const userSpeech = finalTranscript;
                finalTranscript = '';
                
                try { recognition.stop(); } catch(e) {}

                voiceStatus.innerText = "Please listen... (AI processing)";
                voiceTranscript.innerText = `You: "${userSpeech}"`;

                fetchAIReply(userSpeech).then((aiReply) => {
                    if (aiReply && isCallActive) {
                        voiceStatus.innerText = "AI speaking...";
                        voiceTranscript.innerText = `AI: "${aiReply}"`;
                        
                        speakText(aiReply, () => {
                            isProcessing = false;
                            if (isCallActive) {
                                startListeningCycle();
                            }
                        });
                    } else {
                        isProcessing = false;
                        if (isCallActive) startListeningCycle();
                    }
                });
            }
        };

        recognition.onerror = (event) => {
            if (isCallActive && event.error !== 'aborted' && !isProcessing) {
                setTimeout(() => {
                    if (isCallActive) startListeningCycle();
                }, 1000);
            }
        };

        recognition.onend = () => {
            if (isCallActive && !isProcessing) {
                setTimeout(() => {
                    if (isCallActive) startListeningCycle();
                }, 500);
            }
        };

        try {
            recognition.start();
        } catch (e) {
            console.error(e);
        }
    }

    function speakText(text, onComplete) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1;
            utterance.onend = () => {
                if (onComplete) onComplete();
            };
            window.speechSynthesis.speak(utterance);
        } else {
            if (onComplete) onComplete();
        }
    }

    // ==========================================
    // 7. LEAD REGISTRATION FORM SUBMISSION
    // ==========================================
    const leadForm = document.getElementById('nweb-lead-form');
    if (leadForm) {
        leadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('nweb-lead-name').value;
            const email = document.getElementById('nweb-lead-email').value;
            const phone = document.getElementById('nweb-lead-phone').value;
            const msgTag = document.getElementById('nweb-form-msg');

            msgTag.innerText = "Registering...";
            msgTag.style.color = "#00B4D8";

            try {
                const res = await fetch(`${BACKEND_URL}/api/public/register-lead`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agentId, visitorId, name, email, phone })
                });
                const data = await res.json();
                if (res.ok && data.lead) {
                    // 🟢 Form submit hote hi lead ko localStorage mein save karein
                    saveLeadToLocalStorage(data.lead);

                    msgTag.innerText = "Registered successfully! Switched to Chat...";
                    msgTag.style.color = "#10B981";
                    setTimeout(() => {
                        chatTabBtn.click();
                    }, 1000);
                } else {
                    msgTag.innerText = data.message || "Registration failed";
                    msgTag.style.color = "#EF4444";
                }
            } catch (err) {
                msgTag.innerText = "Server Error";
                msgTag.style.color = "#EF4444";
            }
        });
    }
})();