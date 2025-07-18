class WebRTCChat {
    constructor() {
        this.ws = null;
        this.localStream = null;
        this.peerConnections = new Map();
        this.currentUser = null;
        this.currentChannel = 'general';
        this.isMuted = false;
        this.isLoggedIn = false;
        
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
            console.log('Channel clicked:', e.target);
            if (e.target.classList.contains('channel-item')) {
                const channel = e.target.dataset.channel;
                console.log('Joining channel:', channel);
                this.joinChannel(channel);
            } else {
                console.log('Target does not have channel-item class');
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
            console.log('WebSocket connected');
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
            console.log('WebSocket disconnected');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleMessage(message) {
        console.log('Received message:', message);
        switch (message.type) {
            case 'message':
                this.displayMessage(message);
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
        console.log('joinChannel called with:', channelId, 'current:', this.currentChannel);
        if (this.currentChannel === channelId) {
            console.log('Already in channel, returning');
            return;
        }
        
        if (this.currentChannel) {
            console.log('Leaving current channel:', this.currentChannel);
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
        
        console.log('Joining channel:', channelId);
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
        
        console.log('Sending message:', content, 'User:', this.currentUser, 'Channel:', this.currentChannel);
        
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
            console.log('Sending message:', message);
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
        
        if (username !== this.currentUser && this.localStream) {
            this.createPeerConnection(username);
        }
    }

    removeUserFromList(username) {
        const userDiv = document.querySelector(`[data-user="${username}"]`);
        if (userDiv) {
            userDiv.remove();
        }
        
        if (this.peerConnections.has(username)) {
            this.peerConnections.get(username).close();
            this.peerConnections.delete(username);
        }
        
        const audioElement = document.getElementById(`audio-${username}`);
        if (audioElement) {
            audioElement.remove();
        }
    }

    async createPeerConnection(username) {
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });
        
        this.peerConnections.set(username, peerConnection);
        
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
        
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.sendWebSocketMessage({
                type: 'webrtc_offer',
                username: this.currentUser,
                channel: this.currentChannel,
                data: {
                    offer: offer,
                    targetUser: username
                }
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleWebRTCOffer(message) {
        if (message.data.targetUser !== this.currentUser) return;
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });
        
        this.peerConnections.set(message.username, peerConnection);
        
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
                        targetUser: message.username
                    }
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            this.handleRemoteStream(event.streams[0], message.username);
        };
        
        try {
            await peerConnection.setRemoteDescription(message.data.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            this.sendWebSocketMessage({
                type: 'webrtc_answer',
                username: this.currentUser,
                channel: this.currentChannel,
                data: {
                    answer: answer,
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
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(message.data.answer);
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        }
    }

    async handleWebRTCIceCandidate(message) {
        if (message.data.targetUser !== this.currentUser) return;
        
        const peerConnection = this.peerConnections.get(message.username);
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(message.data.candidate);
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
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