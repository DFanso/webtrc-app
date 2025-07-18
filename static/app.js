class WebRTCChat {
    constructor() {
        this.ws = null;
        this.localStream = null;
        this.peerConnections = new Map(); // Map<username, RTCPeerConnection>
        this.currentUser = null;
        this.currentChannel = 'general';
        this.isMuted = false;
        this.isLoggedIn = false;
        this.makingOffer = new Map(); // Map<username, boolean>
        this.ignoreOffer = false;
        this.queuedIceCandidates = new Map(); // Map<username, ICECandidate[]>
        
        this.initUI();
        this.setupEventListeners();
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
        // Only log WebRTC messages for debugging
        if (message.type.startsWith('webrtc_')) {
            console.log('WebRTC message:', message.type, 'from:', message.username);
        }
        
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
            case 'webrtc_offer':
                this.handleWebRTCOffer(message);
                break;
            case 'webrtc_answer':
                this.handleWebRTCAnswer(message);
                break;
            case 'webrtc_ice_candidate':
                this.handleWebRTCIceCandidate(message);
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
        
        this.peerConnections.forEach((pc, userId) => {
            pc.close();
        });
        this.peerConnections.clear();
        
        this.remoteAudioContainer.innerHTML = '';
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
            // Only log WebRTC messages for debugging
            if (message.type.startsWith('webrtc_')) {
                console.log('Sending WebRTC:', message.type, 'to:', message.data?.targetUser || 'all');
            }
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
            // Create peer connection for each user (except self)
            if (username !== this.currentUser) {
                this.createPeerConnection(username);
            }
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
        
        // Clean up peer connection
        if (this.peerConnections.has(username)) {
            const pc = this.peerConnections.get(username);
            if (pc.signalingState !== 'closed') {
                pc.close();
            }
            this.peerConnections.delete(username);
        }
        
        const audioElement = document.getElementById(`audio-${username}`);
        if (audioElement) {
            audioElement.remove();
        }
    }


    async createPeerConnection(username) {
        // Don't create duplicate connections
        if (this.peerConnections.has(username)) {
            return;
        }
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });
        
        this.peerConnections.set(username, peerConnection);
        this.makingOffer.set(username, false);
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendWebSocketMessage({
                    type: 'webrtc_ice_candidate',
                    username: this.currentUser,
                    channel: this.currentChannel,
                    data: {
                        candidate: event.candidate,
                        targetUser: username
                    }
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            this.handleRemoteStream(event.streams[0], username);
        };
        
        // Perfect negotiation pattern
        peerConnection.onnegotiationneeded = async () => {
            try {
                this.makingOffer.set(username, true);
                await peerConnection.setLocalDescription();
                
                this.sendWebSocketMessage({
                    type: 'webrtc_offer',
                    username: this.currentUser,
                    channel: this.currentChannel,
                    data: {
                        offer: peerConnection.localDescription,
                        targetUser: username
                    }
                });
            } catch (error) {
                console.error('Error in negotiation:', error);
            } finally {
                this.makingOffer.set(username, false);
            }
        };
    }

    async handleWebRTCOffer(message) {
        if (message.data.targetUser !== this.currentUser) return;
        
        let peerConnection = this.peerConnections.get(message.username);
        
        // Create connection if it doesn't exist
        if (!peerConnection) {
            await this.createPeerConnection(message.username);
            peerConnection = this.peerConnections.get(message.username);
        }
        
        // Perfect negotiation pattern - determine politeness
        const isPolite = this.currentUser > message.username;
        const offerCollision = (peerConnection.signalingState !== 'stable') || this.makingOffer.get(message.username);
        
        // Ignore offer if we're impolite and there's a collision
        if (!isPolite && offerCollision) {
            console.log(`Ignoring offer collision from ${message.username} (impolite peer)`);
            return;
        }
        
        try {
            // Set remote description (implicit rollback happens if needed)
            await peerConnection.setRemoteDescription(message.data.offer);
            
            // Process any queued ICE candidates
            await this.processQueuedIceCandidates(message.username);
            
            // Create and send answer
            await peerConnection.setLocalDescription();
            
            this.sendWebSocketMessage({
                type: 'webrtc_answer',
                username: this.currentUser,
                channel: this.currentChannel,
                data: {
                    answer: peerConnection.localDescription,
                    targetUser: message.username
                }
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleWebRTCAnswer(message) {
        if (message.data.targetUser !== this.currentUser) return;
        
        const peerConnection = this.peerConnections.get(message.username);
        if (!peerConnection) return;
        
        // Perfect negotiation: only process answers when we're expecting one
        const isExpectingAnswer = peerConnection.signalingState === 'have-local-offer';
        
        if (!isExpectingAnswer) {
            console.log(`Ignoring answer from ${message.username}, not expecting answer (state: ${peerConnection.signalingState})`);
            return;
        }
        
        try {
            await peerConnection.setRemoteDescription(message.data.answer);
            
            // Process any queued ICE candidates
            await this.processQueuedIceCandidates(message.username);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleWebRTCIceCandidate(message) {
        if (message.data.targetUser !== this.currentUser) return;
        
        const peerConnection = this.peerConnections.get(message.username);
        if (!peerConnection) return;
        
        try {
            // Only add ICE candidates if we have a remote description
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(message.data.candidate);
            } else {
                // Queue ICE candidates until we have a remote description
                if (!this.queuedIceCandidates) {
                    this.queuedIceCandidates = new Map();
                }
                if (!this.queuedIceCandidates.has(message.username)) {
                    this.queuedIceCandidates.set(message.username, []);
                }
                this.queuedIceCandidates.get(message.username).push(message.data.candidate);
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    async processQueuedIceCandidates(username) {
        if (!this.queuedIceCandidates || !this.queuedIceCandidates.has(username)) {
            return;
        }
        
        const peerConnection = this.peerConnections.get(username);
        if (!peerConnection) return;
        
        const candidates = this.queuedIceCandidates.get(username);
        this.queuedIceCandidates.delete(username);
        
        for (const candidate of candidates) {
            try {
                await peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.error('Error adding queued ICE candidate:', error);
            }
        }
    }

    handleRemoteStream(stream, username) {
        let audioElement = document.getElementById(`audio-${username}`);
        if (!audioElement) {
            audioElement = document.createElement('audio');
            audioElement.id = `audio-${username}`;
            audioElement.autoplay = true;
            audioElement.className = 'user-audio';
            this.remoteAudioContainer.appendChild(audioElement);
        }
        audioElement.srcObject = stream;
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
        
        this.peerConnections.forEach((pc) => pc.close());
        this.peerConnections.clear();
        
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