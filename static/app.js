class WebRTCChat {
    constructor() {
        this.ws = null;
        this.localStream = null;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.currentUser = null;
        this.currentChannel = 'general';
        this.isMuted = false;
        this.isLoggedIn = false;
        this.isRecording = false;
        this.audioPlayers = new Map(); // Map<username, {context, nextStartTime, bufferQueue}>
        
        this.initUI();
        this.setupEventListeners();
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substr(2, 9);
    }

    initUI() {
        this.authSection = document.getElementById('auth-section');
        this.chatSection = document.getElementById('chat-section');
        this.loginTab = document.getElementById('login-tab');
        this.registerTab = document.getElementById('register-tab');
        this.authForm = document.getElementById('auth-form');
        this.authSubmit = document.getElementById('auth-submit');
        this.authMessage = document.getElementById('auth-message');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.messagesDiv = document.getElementById('messages');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.muteBtn = document.getElementById('mute-btn');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.currentUserSpan = document.getElementById('current-user');
        this.currentChannelSpan = document.getElementById('current-channel');
        this.usersList = document.getElementById('users-list');
        this.channelsList = document.getElementById('channels-list');
        this.remoteAudioContainer = document.getElementById('remote-audio-container');
        
        // Mobile UI elements
        this.sidebar = document.getElementById('sidebar');
        this.mobileMenuBtn = document.getElementById('mobile-menu-btn');
        this.closeSidebarBtn = document.getElementById('close-sidebar');
        this.mobileOverlay = document.getElementById('mobile-overlay');
    }

    setupEventListeners() {
        this.loginTab.addEventListener('click', () => this.switchTab('login'));
        this.registerTab.addEventListener('click', () => this.switchTab('register'));
        this.authForm.addEventListener('submit', (e) => this.handleAuth(e));
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        
        this.channelsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('channel-item')) {
                const channel = e.target.dataset.channel;
                this.joinChannel(channel);
            }
        });

        // Mobile sidebar event listeners
        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener('click', () => this.openMobileSidebar());
        }
        
        if (this.closeSidebarBtn) {
            this.closeSidebarBtn.addEventListener('click', () => this.closeMobileSidebar());
        }
        
        if (this.mobileOverlay) {
            this.mobileOverlay.addEventListener('click', () => this.closeMobileSidebar());
        }

        // Close sidebar on window resize to desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                this.closeMobileSidebar();
            }
        });
    }

    switchTab(tab) {
        if (tab === 'login') {
            this.loginTab.classList.add('bg-blue-600');
            this.loginTab.classList.remove('bg-gray-600');
            this.registerTab.classList.add('bg-gray-600');
            this.registerTab.classList.remove('bg-blue-600');
            this.authSubmit.textContent = 'Login';
        } else {
            this.registerTab.classList.add('bg-blue-600');
            this.registerTab.classList.remove('bg-gray-600');
            this.loginTab.classList.add('bg-gray-600');
            this.loginTab.classList.remove('bg-blue-600');
            this.authSubmit.textContent = 'Register';
        }
    }

    async handleAuth(e) {
        e.preventDefault();
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value;
        const isLogin = this.authSubmit.textContent === 'Login';
        
        if (!username || !password) {
            this.showAuthMessage('Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch(isLogin ? '/login' : '/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                if (isLogin) {
                    this.currentUser = data.user.username;
                    this.showAuthMessage('Login successful!', 'success');
                    await this.initializeChat();
                } else {
                    this.showAuthMessage('Registration successful! Please login.', 'success');
                    this.switchTab('login');
                }
            } else {
                this.showAuthMessage(data.message || 'Authentication failed', 'error');
            }
        } catch (error) {
            this.showAuthMessage('Network error. Please try again.', 'error');
        }
    }

    showAuthMessage(message, type) {
        this.authMessage.textContent = message;
        this.authMessage.className = `mt-4 text-center ${type === 'error' ? 'text-red-400' : 'text-green-400'}`;
        setTimeout(() => {
            this.authMessage.textContent = '';
        }, 3000);
    }

    async initializeChat() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true, 
                video: false 
            });
        } catch (error) {
            this.showAuthMessage('Microphone access denied. Voice chat will not work.', 'error');
        }
        
        this.authSection.classList.add('hidden');
        this.chatSection.classList.remove('hidden');
        this.currentUserSpan.textContent = this.currentUser;
        this.isLoggedIn = true;
        
        this.connectWebSocket();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        
        this.ws.onopen = () => {
            if (this.isLoggedIn) {
                this.currentChannel = null; // Force a fresh join
                this.joinChannel('general');
            }
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };
        
        this.ws.onclose = () => {
            setTimeout(() => this.connectWebSocket(), 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleMessage(message) {
        switch (message.type) {
            case 'message':
                this.displayMessage(message);
                break;
            case 'user_list':
                this.updateUserList(message.data);
                break;
            case 'user_joined':
                this.addUserToList(message.username);
                this.displaySystemMessage(`${message.username} joined the channel`);
                break;
            case 'user_left':
                this.removeUserFromList(message.username);
                this.displaySystemMessage(`${message.username} left the channel`);
                break;
            case 'audio_chunk':
                this.handleAudioChunk(message);
                break;
            case 'audio_data':
                this.handleAudioData(message);
                break;
        }
    }

    joinChannel(channelId) {
        if (this.currentChannel === channelId) {
            return;
        }
        
        if (this.currentChannel) {
            this.sendWebSocketMessage({
                type: 'leave_channel',
                username: this.currentUser,
                channel: this.currentChannel
            });
        }
        
        this.currentChannel = channelId;
        this.currentChannelSpan.textContent = `# ${channelId}`;
        this.messagesDiv.innerHTML = '';
        this.usersList.innerHTML = '';
        
        this.sendWebSocketMessage({
            type: 'join_channel',
            username: this.currentUser,
            channel: channelId
        });
        
        // Stop any existing audio recording
        this.stopAudioRecording();
        this.remoteAudioContainer.innerHTML = '';
        
        // Start audio recording for this channel
        this.startAudioRecording();
    }

    sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content) return;
        
        this.sendWebSocketMessage({
            type: 'message',
            username: this.currentUser,
            content: content,
            channel: this.currentChannel
        });
        
        this.messageInput.value = '';
    }

    sendWebSocketMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.error('WebSocket not connected. State:', this.ws ? this.ws.readyState : 'null');
        }
    }

    displayMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'mb-3 fade-in';
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const isOwnMessage = message.username === this.currentUser;
        
        // Process message content to handle URLs
        const processedContent = this.processMessageContent(message.content);
        
        if (isOwnMessage) {
            // Own messages - right aligned
            messageDiv.innerHTML = `
                <div class="flex justify-end items-end space-x-2 mb-1">
                    <div class="flex flex-col items-end max-w-xs lg:max-w-md">
                        <div class="message-bubble message-own">
                            <div class="message-content">${processedContent}</div>
                        </div>
                        <div class="text-xs text-gray-400 mt-1 px-2">${timestamp}</div>
                    </div>
                    <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                        ${this.currentUser.charAt(0).toUpperCase()}
                    </div>
                </div>
            `;
        } else {
            // Other messages - left aligned
            messageDiv.innerHTML = `
                <div class="flex justify-start items-end space-x-2 mb-1">
                    <div class="w-8 h-8 bg-gray-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                        ${message.username.charAt(0).toUpperCase()}
                    </div>
                    <div class="flex flex-col items-start max-w-xs lg:max-w-md">
                        <div class="text-xs text-gray-400 mb-1 px-2 font-medium">${this.escapeHtml(message.username)}</div>
                        <div class="message-bubble message-other">
                            <div class="message-content">${processedContent}</div>
                        </div>
                        <div class="text-xs text-gray-400 mt-1 px-2">${timestamp}</div>
                    </div>
                </div>
            `;
        }
        
        this.messagesDiv.appendChild(messageDiv);
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
    }

    processMessageContent(content) {
        // Escape HTML first
        const escaped = this.escapeHtml(content);
        
        // URL regex to detect various URL formats
        const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
        
        // Replace URLs with clickable links
        return escaped.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="url-link break-all">${url}</a>`;
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    displaySystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'flex justify-center my-4 fade-in';
        
        messageDiv.innerHTML = `
            <div class="bg-gray-700/50 backdrop-blur-sm text-gray-300 text-sm px-4 py-2 rounded-full border border-gray-600/30">
                <span class="mr-2">ℹ️</span>${this.escapeHtml(content)}
            </div>
        `;
        
        this.messagesDiv.appendChild(messageDiv);
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
    }

    updateUserList(userList) {
        this.usersList.innerHTML = '';
        
        userList.forEach(username => {
            this.addUserToList(username);
        });
    }

    addUserToList(username) {
        if (document.querySelector(`[data-user="${username}"]`)) return;
        
        const userDiv = document.createElement('div');
        userDiv.className = 'flex items-center space-x-2 p-2 bg-gray-700 rounded';
        userDiv.dataset.user = username;
        userDiv.innerHTML = `
            <div class="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>${username}</span>
        `;
        this.usersList.appendChild(userDiv);
    }

    removeUserFromList(username) {
        const userDiv = document.querySelector(`[data-user="${username}"]`);
        if (userDiv) {
            userDiv.remove();
        }
        
        // Clean up audio element
        const audioElement = document.getElementById(`audio-${username}`);
        if (audioElement) {
            audioElement.remove();
        }
        
        // Clean up audio player context
        if (this.audioPlayers.has(username)) {
            const playerInfo = this.audioPlayers.get(username);
            if (playerInfo.context) {
                playerInfo.context.close();
            }
            this.audioPlayers.delete(username);
        }
    }


    async startAudioRecording() {
        if (this.isRecording) {
            console.log('Audio recording already active');
            return;
        }

        try {
            console.log('Starting WebSocket audio recording...');
            
            // Get microphone access with consistent sample rate
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 44100,  // Use standard sample rate
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            console.log('Got microphone access');

            // Create AudioContext for processing
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            
            // Use smaller buffer size to reduce latency
            this.scriptProcessor = this.audioContext.createScriptProcessor(1024, 1, 1);
            
            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                if (!this.isMuted) {
                    const inputBuffer = audioProcessingEvent.inputBuffer;
                    const audioData = inputBuffer.getChannelData(0);
                    this.sendAudioData(audioData);
                }
            };

            // Connect the nodes
            source.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);
            this.isRecording = true;
            
            console.log(`Audio recording started with sample rate: ${this.audioContext.sampleRate}`);
        } catch (error) {
            console.error('Error starting audio recording:', error);
        }
    }

    stopAudioRecording() {
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        this.isRecording = false;
        console.log('Audio recording stopped');
    }

    sendAudioData(audioData) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            // Convert Float32Array to base64
            const samples = new Int16Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                samples[i] = Math.max(-1, Math.min(1, audioData[i])) * 0x7FFF;
            }
            
            const uint8Array = new Uint8Array(samples.buffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Audio = btoa(binary);
            
            console.log(`Sending audio data: ${base64Audio.length} characters`);
            
            this.sendWebSocketMessage({
                type: 'audio_data',
                username: this.currentUser,
                channel: this.currentChannel,
                audioData: base64Audio,
                sampleRate: this.audioContext.sampleRate
            });
        } catch (error) {
            console.error('Error sending audio data:', error);
        }
    }


    async handleAudioData(message) {
        if (message.username === this.currentUser) {
            return; // Don't play our own audio
        }

        try {
            // Validate audio data
            if (!message.audioData || typeof message.audioData !== 'string') {
                console.error('Invalid audio data received');
                return;
            }

            console.log(`Received audio data from ${message.username}: ${message.audioData.length} characters`);

            // Get or create AudioContext and playback tracking for this user
            if (!this.audioPlayers.has(message.username)) {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.audioPlayers.set(message.username, {
                    context: audioContext,
                    nextStartTime: 0,
                    bufferQueue: []
                });
            }

            const playerInfo = this.audioPlayers.get(message.username);
            const audioContext = playerInfo.context;

            // Convert base64 back to audio data
            let binaryString;
            try {
                binaryString = atob(message.audioData);
            } catch (base64Error) {
                console.error('Invalid base64 audio data:', base64Error);
                return;
            }

            // Convert to Int16Array
            const uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
            const int16Array = new Int16Array(uint8Array.buffer);

            // Convert Int16 to Float32 for Web Audio API
            const sampleRate = message.sampleRate || audioContext.sampleRate;
            const audioBuffer = audioContext.createBuffer(1, int16Array.length, sampleRate);
            const channelData = audioBuffer.getChannelData(0);
            
            for (let i = 0; i < int16Array.length; i++) {
                channelData[i] = int16Array[i] / 0x7FFF;
            }

            // Schedule playback to prevent overlapping and crackling
            const currentTime = audioContext.currentTime;
            const startTime = Math.max(currentTime, playerInfo.nextStartTime);
            const bufferDuration = audioBuffer.duration;

            // Create and schedule audio source
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start(startTime);

            // Update next start time to prevent overlapping
            playerInfo.nextStartTime = startTime + bufferDuration;

            console.log(`Scheduled audio from ${message.username} at ${startTime.toFixed(3)}s`);
        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    }

    // Keep the old method for backward compatibility
    async handleAudioChunk(message) {
        // Redirect to new handler
        await this.handleAudioData(message);
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                this.muteBtn.textContent = this.isMuted ? '🔇' : '🎤';
                this.muteBtn.className = this.isMuted ? 
                    'px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700' : 
                    'px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700';
            }
        }
    }

    // Mobile sidebar methods
    openMobileSidebar() {
        if (this.sidebar && this.mobileOverlay) {
            this.sidebar.classList.add('open');
            this.mobileOverlay.classList.add('open');
            document.body.style.overflow = 'hidden'; // Prevent body scrolling
        }
    }

    closeMobileSidebar() {
        if (this.sidebar && this.mobileOverlay) {
            this.sidebar.classList.remove('open');
            this.mobileOverlay.classList.remove('open');
            document.body.style.overflow = ''; // Restore body scrolling
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        
        this.stopAudioRecording();
        
        this.authSection.classList.remove('hidden');
        this.chatSection.classList.add('hidden');
        this.isLoggedIn = false;
        this.currentUser = null;
        
        this.usernameInput.value = '';
        this.passwordInput.value = '';
        this.authMessage.textContent = '';
    }
}

const app = new WebRTCChat();