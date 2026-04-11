const API_URL = 'http://localhost:5278/api';
const HUB_URL = 'http://localhost:5278/chathub';

// Check authentication
const token = localStorage.getItem('token');
const currentUsername = localStorage.getItem('username');

if (!token || !currentUsername) {
    window.location.href = 'login.html';
}

// Global variables
let connection;
let currentRoomId = null;
let currentDMUserId = null;
let currentMode = 'room'; // 'room' or 'dm'
let typingTimeout;
let selectedFile = null;
let pendingMessageId = null;

// WebRTC variables
let localStream = null;
let peerConnection = null;
let currentCallUserId = null;
let isCallInitiator = false;

// DOM elements
const roomList = document.getElementById('roomList');
const dmList = document.getElementById('dmList');
const messageContainer = document.getElementById('messageContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const currentRoomName = document.getElementById('currentRoomName');
const userList = document.getElementById('userList');
const userCount = document.getElementById('userCount');
const typingIndicator = document.getElementById('typingIndicator');
const logoutBtn = document.getElementById('logoutBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const loggedInUser = document.getElementById('loggedInUser');

// Tab buttons
const tabBtns = document.querySelectorAll('.tab-btn');
const roomsTab = document.getElementById('roomsTab');
const directTab = document.getElementById('directTab');

// Modal elements
const createRoomModal = document.getElementById('createRoomModal');
const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomForm = document.getElementById('createRoomForm');

const newDMModal = document.getElementById('newDMModal');
const newDMBtn = document.getElementById('newDMBtn');
const searchUsers = document.getElementById('searchUsers');
const userSearchResults = document.getElementById('userSearchResults');

const addUserModal = document.getElementById('addUserModal');
const addUserBtn = document.getElementById('addUserBtn');
const searchUsersForRoom = document.getElementById('searchUsersForRoom');
const userSearchResultsForRoom = document.getElementById('userSearchResultsForRoom');

// Call elements
const videoCallBtn = document.getElementById('videoCallBtn');
const voiceCallBtn = document.getElementById('voiceCallBtn');
const videoCallModal = document.getElementById('videoCallModal');
const callStatus = document.getElementById('callStatus');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleMute = document.getElementById('toggleMute');
const toggleVideo = document.getElementById('toggleVideo');
const endCall = document.getElementById('endCall');

// Set logged in username
loggedInUser.textContent = currentUsername;

// Initialize SignalR connection
async function initializeSignalR() {
    connection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL, {
            accessTokenFactory: () => token
        })
        .withAutomaticReconnect()
        .build();
    
    // Event handlers - Room messages
    connection.on('LoadHistory', (messages) => {
        messageContainer.innerHTML = '';
        messages.forEach(msg => displayMessage(msg));
        scrollToBottom();
    });
    
    connection.on('ReceiveMessage', (message) => {
        if (currentMode === 'room' && currentRoomId === message.roomId) {
            displayMessage(message);
            scrollToBottom();
            
            if (selectedFile && message.content.includes(selectedFile.name)) {
                pendingMessageId = message.id;
                uploadFile(message.id);
            }
        }
    });
    
    connection.on('MessageUpdated', (message) => {
        updateMessageInUI(message);
    });
    
    // Direct messages
    connection.on('ReceiveDirectMessage', (message) => {
        if (currentMode === 'dm') {
            if (currentDMUserId === message.senderId || currentDMUserId === message.receiverId) {
                displayDirectMessage(message);
                scrollToBottom();
            }
        }
        // Update DM list
        loadDirectMessages();
    });
    
    // Room events
    connection.on('UserJoined', (username) => {
        displaySystemMessage(`${username} joined the room`);
    });
    
    connection.on('UserLeft', (username) => {
        displaySystemMessage(`${username} left the room`);
    });
    
    connection.on('UpdateUserList', (users) => {
        displayUserList(users);
    });
    
    connection.on('UserTyping', (username) => {
        showTypingIndicator(username);
    });
    
    connection.on('UserStoppedTyping', (username) => {
        hideTypingIndicator(username);
    });
    
    // Call events
    connection.on('IncomingCall', async (data) => {
        const accept = confirm(`${data.callerName} is calling you. Accept?`);
        if (accept) {
            currentCallUserId = data.callerId;
            isCallInitiator = false;
            await connection.invoke('AnswerCall', data.callerId);
            await startCall(data.callType === 'video');
        } else {
            await connection.invoke('RejectCall', data.callerId);
        }
    });
    
    connection.on('CallAnswered', async (data) => {
        callStatus.textContent = `Connected with ${data.answererName}`;
    });
    
    connection.on('CallRejected', () => {
        alert('Call rejected');
        closeVideoCallModal();
    });
    
    connection.on('WebRTCSignal', async (signal) => {
        await handleWebRTCSignal(signal);
    });
    
    connection.on('Error', (message) => {
        alert('Error: ' + message);
    });
    
    connection.onreconnecting(() => {
        displaySystemMessage('Reconnecting...');
    });
    
    connection.onreconnected(() => {
        displaySystemMessage('Reconnected');
        if (currentMode === 'room' && currentRoomId) {
            connection.invoke('JoinRoom', currentRoomId);
        }
    });
    
    try {
        await connection.start();
        console.log('SignalR connected');
    } catch (error) {
        console.error('SignalR connection error:', error);
        alert('Failed to connect to chat server');
    }
}

// Load rooms
async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const rooms = await response.json();
            displayRooms(rooms);
        } else {
            console.error('Failed to load rooms');
        }
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

// Display rooms
function displayRooms(rooms) {
    roomList.innerHTML = '';
    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        roomItem.innerHTML = `
            <h3>${room.isPrivate ? '🔒 ' : ''}${escapeHtml(room.name)}</h3>
            <p>${escapeHtml(room.description || '')}</p>
        `;
        roomItem.addEventListener('click', () => joinRoom(room));
        roomList.appendChild(roomItem);
    });
}

// Load direct messages
async function loadDirectMessages() {
    try {
        const response = await fetch(`${API_URL}/directmessages/conversations`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const conversations = await response.json();
            displayConversations(conversations);
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

// Display conversations
function displayConversations(conversations) {
    dmList.innerHTML = '';
    
    if (conversations.length === 0) {
        dmList.innerHTML = '<p style="padding: 20px; text-align: center; color: #999;">No conversations yet</p>';
        return;
    }
    
    conversations.forEach(conv => {
        const dmItem = document.createElement('div');
        dmItem.className = 'dm-item';
        dmItem.innerHTML = `
            <div class="dm-avatar">👤</div>
            <div class="dm-info">
                <div class="dm-name">${escapeHtml(conv.username)}</div>
                <div class="dm-last-message">${escapeHtml(conv.lastMessage.substring(0, 30))}${conv.lastMessage.length > 30 ? '...' : ''}</div>
            </div>
            ${conv.unreadCount > 0 ? `<span class="dm-unread">${conv.unreadCount}</span>` : ''}
        `;
        dmItem.addEventListener('click', () => openDirectMessage(conv.userId, conv.username));
        dmList.appendChild(dmItem);
    });
}

// Join room
async function joinRoom(room) {
    if (currentMode === 'room' && currentRoomId === room.id) return;
    
    try {
        // Switch to room mode
        currentMode = 'room';
        currentRoomId = room.id;
        currentDMUserId = null;
        
        // Update UI
        document.querySelectorAll('.room-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.dm-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');
        
        currentRoomName.textContent = room.name;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        attachBtn.disabled = false;
        messageContainer.innerHTML = '';
        typingIndicator.textContent = '';
        
        // Show/hide call buttons (only for DMs)
        videoCallBtn.style.display = 'none';
        voiceCallBtn.style.display = 'none';
        addUserBtn.style.display = room.isPrivate ? 'inline-block' : 'none';
        
        // Join via SignalR
        await connection.invoke('JoinRoom', room.id);
    } catch (error) {
        console.error('Error joining room:', error);
    }
}

// Open direct message
async function openDirectMessage(userId, username) {
    try {
        // Switch to DM mode
        currentMode = 'dm';
        currentDMUserId = userId;
        currentRoomId = null;
        
        // Update UI
        document.querySelectorAll('.room-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelectorAll('.dm-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');
        
        currentRoomName.textContent = `@${username}`;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        attachBtn.disabled = true; // Disable file upload in DMs for now
        messageContainer.innerHTML = '';
        typingIndicator.textContent = '';
        userList.textContent = '';
        userCount.textContent = '';
        
        // Show call buttons
        videoCallBtn.style.display = 'inline-block';
        voiceCallBtn.style.display = 'inline-block';
        addUserBtn.style.display = 'none';
        
        // Load messages
        const response = await fetch(`${API_URL}/directmessages/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(msg => displayDirectMessage(msg));
            scrollToBottom();
        }
    } catch (error) {
        console.error('Error opening DM:', error);
    }
}

// Display message (room)
function displayMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.setAttribute('data-message-id', message.id);
    
    const time = new Date(message.createdAt).toLocaleTimeString();
    
    let attachmentsHtml = '';
    if (message.attachments && message.attachments.length > 0) {
        message.attachments.forEach(attachment => {
            if (attachment.fileType.startsWith('image/')) {
                attachmentsHtml += `
                    <div class="message-attachment">
                        <img src="${API_URL.replace('/api', '')}${attachment.fileUrl}" 
                             alt="${escapeHtml(attachment.fileName)}"
                             class="message-image"
                             onclick="openLightbox('${API_URL.replace('/api', '')}${attachment.fileUrl}')">
                    </div>
                `;
            } else {
                attachmentsHtml += `
                    <div class="message-attachment">
                        <a href="${API_URL.replace('/api', '')}${attachment.fileUrl}" 
                           class="message-file" 
                           download="${escapeHtml(attachment.fileName)}"
                           target="_blank">
                            <span class="file-icon">📄</span>
                            <div class="file-info">
                                <span class="file-name">${escapeHtml(attachment.fileName)}</span>
                                <span class="file-size">${formatFileSize(attachment.fileSize)}</span>
                            </div>
                        </a>
                    </div>
                `;
            }
        });
    }
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${escapeHtml(message.username)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${escapeHtml(message.content)}</div>
        ${attachmentsHtml}
    `;
    
    messageContainer.appendChild(messageDiv);
}

// Display direct message
function displayDirectMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const time = new Date(message.createdAt).toLocaleTimeString();
    const isOwn = message.senderUsername === currentUsername;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${escapeHtml(message.senderUsername)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content ${isOwn ? 'own-message' : ''}">${escapeHtml(message.content)}</div>
    `;
    
    messageContainer.appendChild(messageDiv);
}

// Update message in UI with attachments
function updateMessageInUI(message) {
    const messageDiv = document.querySelector(`[data-message-id="${message.id}"]`);
    if (!messageDiv) return;
    
    const time = new Date(message.createdAt).toLocaleTimeString();
    
    let attachmentsHtml = '';
    if (message.attachments && message.attachments.length > 0) {
        message.attachments.forEach(attachment => {
            if (attachment.fileType.startsWith('image/')) {
                attachmentsHtml += `
                    <div class="message-attachment">
                        <img src="${API_URL.replace('/api', '')}${attachment.fileUrl}" 
                             alt="${escapeHtml(attachment.fileName)}"
                             class="message-image"
                             onclick="openLightbox('${API_URL.replace('/api', '')}${attachment.fileUrl}')">
                    </div>
                `;
            } else {
                attachmentsHtml += `
                    <div class="message-attachment">
                        <a href="${API_URL.replace('/api', '')}${attachment.fileUrl}" 
                           class="message-file" 
                           download="${escapeHtml(attachment.fileName)}"
                           target="_blank">
                            <span class="file-icon">📄</span>
                            <div class="file-info">
                                <span class="file-name">${escapeHtml(attachment.fileName)}</span>
                                <span class="file-size">${formatFileSize(attachment.fileSize)}</span>
                            </div>
                        </a>
                    </div>
                `;
            }
        });
    }
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${escapeHtml(message.username)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${escapeHtml(message.content)}</div>
        ${attachmentsHtml}
    `;
}

// Display system message
function displaySystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = text;
    messageContainer.appendChild(messageDiv);
    scrollToBottom();
}

// Display user list
function displayUserList(users) {
    if (users.length === 0) {
        userList.textContent = '';
        userCount.textContent = '';
        return;
    }
    
    userList.textContent = `Users in room: ${users.join(', ')}`;
    userCount.textContent = `${users.length} user${users.length !== 1 ? 's' : ''} online`;
}

// Typing indicators
let activeTypingUsers = new Set();

function showTypingIndicator(username) {
    activeTypingUsers.add(username);
    updateTypingIndicator();
}

function hideTypingIndicator(username) {
    activeTypingUsers.delete(username);
    updateTypingIndicator();
}

function updateTypingIndicator() {
    if (activeTypingUsers.size === 0) {
        typingIndicator.textContent = '';
    } else if (activeTypingUsers.size === 1) {
        typingIndicator.textContent = `${Array.from(activeTypingUsers)[0]} is typing...`;
    } else {
        typingIndicator.textContent = `${activeTypingUsers.size} users are typing...`;
    }
}

// File upload handling
attachBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
        alert('File size exceeds 10 MB limit');
        fileInput.value = '';
        return;
    }
    
    selectedFile = file;
    showFilePreview(file);
});

function showFilePreview(file) {
    const existingPreview = document.getElementById('filePreview');
    if (existingPreview) {
        existingPreview.remove();
    }
    
    const preview = document.createElement('div');
    preview.className = 'file-preview';
    preview.id = 'filePreview';
    
    const fileName = document.createElement('span');
    fileName.className = 'file-preview-name';
    
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            fileName.innerHTML = `🖼️ <img src="${e.target.result}" style="max-height: 50px; vertical-align: middle; margin-right: 10px; border-radius: 5px;"> ${escapeHtml(file.name)} (${formatFileSize(file.size)})`;
        };
        reader.readAsDataURL(file);
    } else {
        fileName.textContent = `📎 ${file.name} (${formatFileSize(file.size)})`;
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-preview-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        clearFilePreview();
    });
    
    preview.appendChild(fileName);
    preview.appendChild(removeBtn);
    
    const container = document.querySelector('.message-input-container');
    container.parentNode.insertBefore(preview, container);
}

function clearFilePreview() {
    selectedFile = null;
    fileInput.value = '';
    pendingMessageId = null;
    const preview = document.getElementById('filePreview');
    if (preview) {
        preview.remove();
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Upload file to server
async function uploadFile(messageId) {
    if (!selectedFile) return;
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('messageId', messageId);
    
    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (response.ok) {
            await connection.invoke('NotifyAttachmentAdded', messageId, currentRoomId);
            clearFilePreview();
        } else {
            const error = await response.json();
            alert('Failed to upload file: ' + error.message);
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload file. Please try again.');
    }
}

// Send message
async function sendMessage() {
    const content = messageInput.value.trim();
    
    if (!content && !selectedFile) return;
    
    if (currentMode === 'dm' && !currentDMUserId) {
        alert('Please select a conversation');
        return;
    }
    
    if (currentMode === 'room' && !currentRoomId) {
        alert('Please join a room first');
        return;
    }
    
    if (!connection || connection.state !== 'Connected') {
        alert('Not connected to server. Please refresh the page.');
        return;
    }
    
    try {
        if (currentMode === 'dm') {
            // Send direct message
            await connection.invoke('SendDirectMessage', currentDMUserId, content);
        } else {
            // Send room message
            let messageText = content;
            
            if (selectedFile) {
                if (messageText) {
                    messageText += ` 📎`;
                } else {
                    messageText = `📎 ${selectedFile.name}`;
                }
            }
            
            await connection.invoke('SendMessage', currentRoomId, messageText);
        }
        
        messageInput.value = '';
        
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message: ' + error.message);
        clearFilePreview();
    }
}

// Handle typing
function handleTyping() {
    if (currentMode !== 'room' || !currentRoomId) return;
    
    clearTimeout(typingTimeout);
    
    connection.invoke('Typing', currentRoomId).catch(err => {
        console.error('Error sending typing indicator:', err);
    });
    
    typingTimeout = setTimeout(() => {}, 3000);
}

// Tabs
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        
        if (tab === 'rooms') {
            roomsTab.classList.add('active');
        } else if (tab === 'direct') {
            directTab.classList.add('active');
            loadDirectMessages();
        }
    });
});

// Create Room Modal
createRoomBtn.addEventListener('click', () => {
    createRoomModal.classList.add('active');
});

createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('roomName').value;
    const description = document.getElementById('roomDescription').value;
    const isPrivate = document.getElementById('isPrivateRoom').checked;
    
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, description, isPrivate })
        });
        
        if (response.ok) {
            createRoomModal.classList.remove('active');
            createRoomForm.reset();
            await loadRooms();
            alert('Room created successfully!');
        } else {
            const error = await response.json();
            alert(error.message || 'Failed to create room');
        }
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Failed to create room');
    }
});

// New DM Modal
newDMBtn.addEventListener('click', () => {
    newDMModal.classList.add('active');
});

let searchTimeout;
searchUsers.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    
    const query = e.target.value.trim();
    
    if (query.length < 2) {
        userSearchResults.innerHTML = '';
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_URL}/users/search?query=${encodeURIComponent(query)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                displayUserSearchResults(users, userSearchResults, (user) => {
                    newDMModal.classList.remove('active');
                    searchUsers.value = '';
                    userSearchResults.innerHTML = '';
                    openDirectMessage(user.id, user.username);
                });
            }
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }, 300);
});

// Add User to Room
addUserBtn.addEventListener('click', () => {
    if (!currentRoomId) {
        alert('Please join a room first');
        return;
    }
    addUserModal.classList.add('active');
});

searchUsersForRoom.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    
    const query = e.target.value.trim();
    
    if (query.length < 2) {
        userSearchResultsForRoom.innerHTML = '';
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_URL}/users/search?query=${encodeURIComponent(query)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                displayUserSearchResults(users, userSearchResultsForRoom, async (user) => {
                    await inviteUserToRoom(user.username);
                });
            }
        } catch (error) {
            console.error('Error searching users:', error);
        }
    }, 300);
});

function displayUserSearchResults(users, container, onClickCallback) {
    container.innerHTML = '';
    
    if (users.length === 0) {
        container.innerHTML = '<p style="padding: 10px; color: #999;">No users found</p>';
        return;
    }
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-search-item';
        userItem.innerHTML = `
            <div class="dm-avatar">👤</div>
            <span>${escapeHtml(user.username)}</span>
        `;
        userItem.addEventListener('click', () => onClickCallback(user));
        container.appendChild(userItem);
    });
}

async function inviteUserToRoom(username) {
    try {
        const response = await fetch(`${API_URL}/rooms/${currentRoomId}/invite`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(username)
        });
        
        if (response.ok) {
            alert('User invited successfully!');
            addUserModal.classList.remove('active');
            searchUsersForRoom.value = '';
            userSearchResultsForRoom.innerHTML = '';
        } else {
            const error = await response.json();
            alert(error.message || 'Failed to invite user');
        }
    } catch (error) {
        console.error('Error inviting user:', error);
        alert('Failed to invite user');
    }
}

// Video/Voice Calls
videoCallBtn.addEventListener('click', () => initiateCall('video'));
voiceCallBtn.addEventListener('click', () => initiateCall('audio'));

async function initiateCall(callType) {
    if (!currentDMUserId) {
        alert('Please select a user to call');
        return;
    }
    
    try {
        currentCallUserId = currentDMUserId;
        isCallInitiator = true;
        
        await connection.invoke('InitiateCall', currentDMUserId, callType);
        await startCall(callType === 'video');
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Failed to initiate call');
    }
}

async function startCall(withVideo) {
    try {
        videoCallModal.classList.add('active');
        callStatus.textContent = 'Connecting...';
        
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: withVideo,
            audio: true
        });
        
        localVideo.srcObject = localStream;
        
        // Create peer connection
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        peerConnection = new RTCPeerConnection(configuration);
        
        // Add local stream tracks
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                callStatus.textContent = 'Connected';
            }
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = async (event) => {
            if (event.candidate) {
                await connection.invoke('SendWebRTCSignal', currentCallUserId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };
        
        // Create and send offer if initiator
        if (isCallInitiator) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            await connection.invoke('SendWebRTCSignal', currentCallUserId, {
                type: 'offer',
                sdp: offer
            });
        }
        
    } catch (error) {
        console.error('Error starting call:', error);
        alert('Failed to access camera/microphone');
        closeVideoCallModal();
    }
}

async function handleWebRTCSignal(signal) {
    try {
        if (signal.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            await connection.invoke('SendWebRTCSignal', currentCallUserId, {
                type: 'answer',
                sdp: answer
            });
        } else if (signal.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'ice-candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    } catch (error) {
        console.error('Error handling WebRTC signal:', error);
    }
}

toggleMute.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleMute.textContent = audioTrack.enabled ? '🎤' : '🔇';
        }
    }
});

toggleVideo.addEventListener('click', () => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleVideo.textContent = videoTrack.enabled ? '📹' : '🚫';
        }
    }
});

endCall.addEventListener('click', () => {
    closeVideoCallModal();
});

function closeVideoCallModal() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    videoCallModal.classList.remove('active');
    currentCallUserId = null;
    isCallInitiator = false;
}

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
        closeBtn.closest('.modal').classList.remove('active');
    });
});

// Close modals on background click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// Utility functions
function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Image lightbox
function openLightbox(imageUrl) {
    let lightbox = document.getElementById('lightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'lightbox';
        lightbox.className = 'lightbox';
        lightbox.innerHTML = `
            <button class="lightbox-close" onclick="closeLightbox()">×</button>
            <img class="lightbox-image" id="lightboxImage" src="">
        `;
        document.body.appendChild(lightbox);
        
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        });
    }
    
    document.getElementById('lightboxImage').src = imageUrl;
    lightbox.classList.add('active');
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
    }
}

// Event listeners
sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage();
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', handleTyping);

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    window.location.href = 'login.html';
});

// Initialize
(async () => {
    console.log('Initializing chat...');
    await initializeSignalR();
    await loadRooms();
    await loadDirectMessages();
    console.log('Chat initialized');
})();