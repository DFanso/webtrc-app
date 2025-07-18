class WebRTCChat {
    constructor() {
        this.ws = null;
        this.localStream = null;
        this.sfuConnection = null; // Single connection to SFU
        this.currentUser = null;
        this.currentChannel = 'general';
        this.isMuted = false;
        this.isLoggedIn = false;
        this.clientId = this.generateClientId(); // Unique client ID
        
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
        
        // Close existing SFU connection and create new one
        if (this.sfuConnection) {
            this.sfuConnection.close();
            this.sfuConnection = null;
        }
        this.remoteAudioContainer.innerHTML = '';
        
        // Create new SFU connection for this channel
        this.connectToSFU(channelId);
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
        messageDiv.className = 'flex items-start space-x-3 p-2 hover:bg-gray-800 rounded';
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        messageDiv.innerHTML = `
            <div class="font-semibold text-blue-400">${message.username}:</div>
            <div class="flex-1">${message.content}</div>
            <div class="text-xs text-gray-500">${timestamp}</div>
        `;
        
        this.messagesDiv.appendChild(messageDiv);
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
    }

    displaySystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'text-center text-gray-500 text-sm py-2';
        messageDiv.textContent = content;
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
    }


    async connectToSFU(channelId) {
        // Prevent duplicate connections
        if (this.sfuConnection && this.sfuConnection.connectionState !== 'closed') {
            console.log('SFU connection already exists, skipping');
            return;
        }
        
        console.log(`Attempting to connect to SFU for channel: ${channelId}, clientId: ${this.clientId}`);
        try {
            // Create new peer connection to SFU
            this.sfuConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            });

            console.log('Created RTCPeerConnection');

            // Add local stream to connection
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    console.log(`Adding track to SFU connection: ${track.kind}`);
                    this.sfuConnection.addTrack(track, this.localStream);
                });
            } else {
                console.warn('No local stream available for SFU connection');
            }

            // Handle incoming streams from SFU
            this.sfuConnection.ontrack = (event) => {
                console.log('Received track from SFU:', event.track.kind);
                this.handleRemoteStream(event.streams[0], 'sfu-stream');
            };

            // Create offer and send to SFU
            console.log('Creating offer...');
            const offer = await this.sfuConnection.createOffer();
            await this.sfuConnection.setLocalDescription(offer);
            console.log('Created and set local description');

            // Send offer to SFU server
            console.log('Sending offer to SFU server...');
            const response = await fetch('/sfu', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'offer',
                    sdp: offer,
                    channel: channelId,
                    clientId: this.clientId
                })
            });

            console.log('SFU response status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('SFU response data:', data);
                if (data.type === 'answer') {
                    await this.sfuConnection.setRemoteDescription(data.sdp);
                    console.log('Connected to SFU successfully');
                }
            } else {
                console.error('SFU request failed:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('Error connecting to SFU:', error);
        }
    }


    handleRemoteStream(stream, username) {
        console.log(`Handling remote stream for ${username}:`, stream);
        console.log(`Stream has ${stream.getTracks().length} tracks`);
        
        let audioElement = document.getElementById(`audio-${username}`);
        if (!audioElement) {
            console.log(`Creating new audio element for ${username}`);
            audioElement = document.createElement('audio');
            audioElement.id = `audio-${username}`;
            audioElement.autoplay = true;
            audioElement.controls = true; // Add controls for debugging
            audioElement.className = 'user-audio';
            audioElement.style.display = 'block'; // Make visible for debugging
            this.remoteAudioContainer.appendChild(audioElement);
        }
        
        audioElement.srcObject = stream;
        
        // Add event listeners for debugging
        audioElement.addEventListener('loadedmetadata', () => {
            console.log(`Audio element loaded metadata for ${username}`);
        });
        
        audioElement.addEventListener('canplay', () => {
            console.log(`Audio element can play for ${username}`);
        });
        
        audioElement.addEventListener('play', () => {
            console.log(`Audio element started playing for ${username}`);
        });
        
        audioElement.addEventListener('error', (e) => {
            console.error(`Audio element error for ${username}:`, e);
        });
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

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.sfuConnection) {
            this.sfuConnection.close();
        }
        
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