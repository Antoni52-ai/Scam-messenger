let connection;
let typingTimer;
let searchDebounceTimer;
let notificationAudioContext;
let profileUserNameHint = '';
const TYPING_DELAY = 1000;
const SEARCH_DELAY = 300;
const STORAGE_SOUND_KEY = 'nova.messenger.soundEnabled';
const BASE_TITLE = 'NOVA MESSENGER';

const CHAT_MODE_PUBLIC = 'public';
const CHAT_MODE_PRIVATE = 'private';
const CHAT_MODE_ROOM = 'room';

const state = {
    mode: CHAT_MODE_PUBLIC,
    targetUserId: null,
    targetUserName: null,
    activeRoomId: null,
    activeRoomName: null,
    rooms: [],
    adminRooms: new Set(),
    unreadCount: 0,
    unreadUsers: {},
    unreadRooms: {},
    soundEnabled: true
};

function getCurrentUserName() {
    return window.chatConfig?.currentUserName || '';
}

function getCurrentUserId() {
    return window.chatConfig?.currentUserId || '';
}

function normalizeInitialConfig() {
    if (!window.chatConfig) {
        window.chatConfig = {};
    }

    state.targetUserId = window.chatConfig.targetUserId || null;
    state.targetUserName = window.chatConfig.targetUserName || null;
    state.activeRoomId = window.chatConfig.activeRoomId || null;
}

function loadSoundPreference() {
    const raw = localStorage.getItem(STORAGE_SOUND_KEY);
    if (raw === null) {
        return true;
    }

    return raw !== '0';
}

function persistSoundPreference() {
    localStorage.setItem(STORAGE_SOUND_KEY, state.soundEnabled ? '1' : '0');
}

function updateSoundToggleButton() {
    const button = document.getElementById('soundToggleBtn');
    if (!button) {
        return;
    }

    button.textContent = state.soundEnabled ? 'Звук: вкл' : 'Звук: выкл';
    button.setAttribute('aria-pressed', state.soundEnabled ? 'true' : 'false');
    button.classList.toggle('is-muted', !state.soundEnabled);
}

function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    persistSoundPreference();
    updateSoundToggleButton();
}

function updateDocumentTitle() {
    if (state.unreadCount > 0) {
        document.title = `(${state.unreadCount}) ${BASE_TITLE}`;
        return;
    }

    document.title = BASE_TITLE;
}

function incrementUnreadCount() {
    state.unreadCount += 1;
    updateDocumentTitle();
}

function resetUnreadCount() {
    if (state.unreadCount === 0) {
        return;
    }

    state.unreadCount = 0;
    updateDocumentTitle();
}

document.addEventListener('DOMContentLoaded', async () => {
    normalizeInitialConfig();
    state.soundEnabled = loadSoundPreference();
    updateSoundToggleButton();
    updateDocumentTitle();
    setupEventListeners();
    setupDragAndDrop();
    await initializeSignalR();
});

async function initializeSignalR() {
    connection = new signalR.HubConnectionBuilder()
        .withUrl('/hub/chat', { withCredentials: true })
        .withAutomaticReconnect([0, 2000, 5000, 10000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    registerSignalRHandlers();

    try {
        await connection.start();
        requestNotificationPermission();
        setConnectionState(true);
        showStatus('Подключено', 'success');

        await connection.invoke('GetUserList');
        await connection.invoke('GetUserRooms');
        await switchToPublicChat({ loadHistory: true });
    } catch (error) {
        console.error('SignalR connection failed:', error);
        setConnectionState(false);
        showStatus('Ошибка подключения', 'error');
        setTimeout(initializeSignalR, 5000);
    }
}

function registerSignalRHandlers() {
    connection.on('UserList', updateUserList);
    connection.on('OnlineUsersUpdated', updateUserList);
    connection.on('UserRooms', renderRoomList);

    connection.on('NewMessage', (message) => {
        handleIncomingMessage(message);
    });

    connection.on('RoomMessage', (message) => {
        handleIncomingMessage(message);
    });

    connection.on('MessageHistory', (messages) => {
        renderMessageHistory(messages || []);
    });

    connection.on('OlderMessages', (messages) => {
        prependOlderMessages(messages || []);
    });

    connection.on('MessageEdited', (payload) => {
        applyEditedMessage(payload);
    });

    connection.on('MessageDeleted', (payload) => {
        applyDeletedMessage(payload);
    });

    connection.on('KickedFromRoom', (payload) => {
        handleKickedFromRoom(payload).catch(console.error);
    });

    connection.on('UserProfile', (profile) => {
        openUserProfileModal(profile);
    });

    connection.on('UserJoined', (user) => {
        addOnlineUser(user.userId, user.userName);
        showSystemMessage(`${user.userName} присоединился к чату`);
    });

    connection.on('UserLeft', (user) => {
        removeOnlineUser(user.userId, user.userName);
        showSystemMessage(`${user.userName} покинул чат`);
    });

    connection.on('UserTyping', (userName) => {
        showTypingIndicator(userName);
    });

    connection.on('SystemMessage', (data) => {
        if (data?.text) {
            showSystemMessage(data.text);
        }
    });

    connection.onreconnecting(() => {
        setConnectionState(false);
    });

    connection.onreconnected(async () => {
        setConnectionState(true);
        await connection.invoke('GetUserList');
        await connection.invoke('GetUserRooms');
    });

    connection.onclose(() => {
        setConnectionState(false);
    });
}

function handleIncomingMessage(message) {
    if (!message) {
        return;
    }

    const isOwn = isOwnMessage(message);
    const isActiveChat = isMessageForActiveContext(message);

    if (isActiveChat) {
        appendMessage(message);
        scrollToBottom();
    }

    if (!isOwn) {
        handleUnreadStateForIncoming(message, isActiveChat);
        playNotificationSound();
        showBrowserNotification(message, isActiveChat);
    }
}

function handleUnreadStateForIncoming(message, isActiveChat) {
    if (document.hidden || !isActiveChat) {
        incrementUnreadCount();
    }

    if (isPrivateMessage(message)) {
        const otherUserId = getPrivateOtherUserId(message);
        if (otherUserId && !isPrivateChatOpenWith(otherUserId)) {
            incrementUserUnread(otherUserId);
        }
    }

    if (isRoomMessage(message) && message.roomId && !isRoomChatOpen(message.roomId)) {
        incrementRoomUnread(message.roomId);
    }
}

function isPrivateChatOpenWith(userId) {
    return state.mode === CHAT_MODE_PRIVATE && state.targetUserId === userId;
}

function isRoomChatOpen(roomId) {
    return state.mode === CHAT_MODE_ROOM && state.activeRoomId === roomId;
}

function requestNotificationPermission() {
    if (!('Notification' in window)) {
        return;
    }

    if (Notification.permission === 'default') {
        Notification.requestPermission().catch(console.error);
    }
}

function showBrowserNotification(message, isActiveChat) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    if (!document.hidden && isActiveChat) {
        return;
    }

    const senderName = message.senderName || message.sender || 'Новое сообщение';
    const previewText = (message.content || '').substring(0, 100);
    const notification = new Notification(senderName, {
        body: previewText,
        tag: message.id || `message-${Date.now()}`,
        icon: '/images/avatar-placeholder.png'
    });

    notification.onclick = () => {
        window.focus();
        navigateToMessageContext(message).catch(console.error);
        notification.close();
    };
}

async function navigateToMessageContext(message) {
    if (isRoomMessage(message) && message.roomId) {
        const roomName = message.roomName || findRoomNameById(message.roomId) || 'Комната';
        await startRoomChat(message.roomId, roomName);
        return;
    }

    if (isPrivateMessage(message)) {
        const otherUserId = getPrivateOtherUserId(message);
        if (otherUserId) {
            const userName = message.senderName || findUserNameById(otherUserId) || 'Пользователь';
            await startPrivateChat(otherUserId, userName);
            return;
        }
    }

    await switchToPublicChat({ loadHistory: true });
}

function playNotificationSound() {
    if (!state.soundEnabled) {
        return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        return;
    }

    if (!notificationAudioContext) {
        notificationAudioContext = new AudioContextClass();
    }

    if (notificationAudioContext.state === 'suspended') {
        notificationAudioContext.resume().catch(console.error);
    }

    const oscillator = notificationAudioContext.createOscillator();
    const gain = notificationAudioContext.createGain();

    oscillator.connect(gain);
    gain.connect(notificationAudioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gain.gain.value = 0.1;

    oscillator.start();
    oscillator.stop(notificationAudioContext.currentTime + 0.15);
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !connection) {
        return;
    }

    const content = input.value.trim();
    if (!content) {
        return;
    }

    try {
        if (state.mode === CHAT_MODE_PRIVATE && state.targetUserId) {
            await connection.invoke('SendPrivateMessage', state.targetUserId, content);
        } else if (state.mode === CHAT_MODE_ROOM && state.activeRoomId) {
            await connection.invoke('SendRoomMessage', state.activeRoomId, content);
        } else {
            await connection.invoke('SendMessage', content);
        }

        input.value = '';
        hideTypingIndicator();
    } catch (error) {
        console.error('Failed to send message:', error);
        showStatus('Не удалось отправить сообщение', 'error');
    }
}

async function uploadAndSendFile(file) {
    if (!file || !connection) {
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || 'Upload failed.');
        }

        const uploaded = await response.json();
        const targetUserId = state.mode === CHAT_MODE_PRIVATE ? state.targetUserId : null;
        const roomId = state.mode === CHAT_MODE_ROOM ? state.activeRoomId : null;

        await connection.invoke(
            'SendFileMessage',
            uploaded.url,
            uploaded.fileName,
            uploaded.size,
            targetUserId,
            roomId
        );
    } catch (error) {
        console.error('File upload failed:', error);
        showStatus('Не удалось отправить файл', 'error');
    }
}

function handleTyping() {
    if (!connection) {
        return;
    }

    const target = state.mode === CHAT_MODE_PRIVATE ? state.targetUserId : null;
    connection.invoke('SendTyping', target).catch(console.error);

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        // no-op
    }, TYPING_DELAY);
}

function getInitials(name) {
    if (!name) {
        return '?';
    }

    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return name.substring(0, 2).toUpperCase();
}

function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function buildUserItem(userId, userName) {
    const item = document.createElement('li');
    item.className = 'user-item';
    item.dataset.userId = userId || '';

    if (state.mode === CHAT_MODE_PRIVATE && state.targetUserId === userId) {
        item.classList.add('active');
    }

    const avatar = document.createElement('div');
    avatar.className = 'user-avatar user-avatar-clickable';
    avatar.textContent = getInitials(userName);
    avatar.title = 'Открыть профиль';
    avatar.tabIndex = 0;

    avatar.addEventListener('click', (event) => {
        event.stopPropagation();
        requestUserProfile(userId, userName);
    });

    avatar.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            requestUserProfile(userId, userName);
        }
    });

    const dot = document.createElement('span');
    dot.className = 'user-status';

    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = userName;

    item.appendChild(avatar);
    item.appendChild(dot);
    item.appendChild(name);

    if (userId) {
        item.addEventListener('click', () => {
            startPrivateChat(userId, userName).catch(console.error);
        });
    }

    syncUnreadBadgeOnNode(item, getUnreadUserCount(userId));
    return item;
}

function updateUserList(users) {
    const list = document.getElementById('onlineUsers');
    const count = document.getElementById('onlineCount');
    if (!list || !count) {
        return;
    }

    clearChildren(list);

    const currentUserId = getCurrentUserId();
    const otherUsers = (users || []).filter((user) => user.userId !== currentUserId);

    otherUsers.forEach((user) => {
        list.appendChild(buildUserItem(user.userId, user.userName));
    });

    count.textContent = String(otherUsers.length);
}

function addOnlineUser(userId, userName) {
    const list = document.getElementById('onlineUsers');
    if (!list || userId === getCurrentUserId()) {
        return;
    }

    const exists = Array.from(list.querySelectorAll('.user-item')).some((item) => item.dataset.userId === userId);
    if (exists) {
        return;
    }

    list.appendChild(buildUserItem(userId, userName));

    const count = document.getElementById('onlineCount');
    if (count) {
        const value = Number.parseInt(count.textContent || '0', 10) || 0;
        count.textContent = String(value + 1);
    }
}

function removeOnlineUser(userId, userName) {
    const list = document.getElementById('onlineUsers');
    if (!list) {
        return;
    }

    const item = Array.from(list.querySelectorAll('.user-item')).find((node) => {
        if (userId && node.dataset.userId === userId) {
            return true;
        }

        const name = node.querySelector('.user-name');
        return name?.textContent === userName;
    });

    if (item) {
        item.remove();

        const count = document.getElementById('onlineCount');
        if (count) {
            const value = Number.parseInt(count.textContent || '0', 10) || 0;
            count.textContent = String(Math.max(0, value - 1));
        }
    }
}

function renderRoomList(rooms) {
    state.rooms = rooms || [];
    state.adminRooms = new Set(state.rooms.filter((room) => room.isAdmin).map((room) => room.id));

    const list = document.getElementById('roomList');
    const count = document.getElementById('roomCount');
    if (!list || !count) {
        return;
    }

    clearChildren(list);
    count.textContent = String(state.rooms.length);

    state.rooms.forEach((room) => {
        const item = document.createElement('li');
        item.className = 'room-item';
        item.dataset.roomId = room.id;

        if (state.mode === CHAT_MODE_ROOM && state.activeRoomId === room.id) {
            item.classList.add('active');
        }

        const title = document.createElement('span');
        title.className = 'room-name';
        title.textContent = room.name;

        const meta = document.createElement('small');
        meta.className = 'room-meta';
        meta.textContent = room.description || 'Без описания';

        item.appendChild(title);
        item.appendChild(meta);
        syncUnreadBadgeOnNode(item, getUnreadRoomCount(room.id));
        item.addEventListener('click', () => {
            startRoomChat(room.id, room.name).catch(console.error);
        });

        list.appendChild(item);
    });
}

function renderMessageHistory(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const visibleMessages = filterHistoryForCurrentMode(messages || []);

    clearChildren(container);

    if (state.mode === CHAT_MODE_PUBLIC) {
        addLoadMoreButton();
    }

    visibleMessages.forEach((message) => {
        container.appendChild(buildMessageElement(message));
    });

    applyMessageSearch(getSearchQuery());
    scrollToBottom();
}

function prependOlderMessages(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (!loadMoreBtn) {
        return;
    }

    if (messages.length === 0) {
        loadMoreBtn.style.display = 'none';
        return;
    }

    const fragment = document.createDocumentFragment();
    messages.forEach((message) => {
        if (!message?.id || container.querySelector(`[data-message-id="${message.id}"]`)) {
            return;
        }

        fragment.appendChild(buildMessageElement(message));
    });

    const previousHeight = container.scrollHeight;
    container.insertBefore(fragment, loadMoreBtn.nextSibling);
    container.scrollTop = container.scrollHeight - previousHeight;
    loadMoreBtn.disabled = false;
    applyMessageSearch(getSearchQuery());
}

function buildMessageElement(message) {
    const sender = message.senderName || message.sender || 'Пользователь';
    const isOwn = isOwnMessage(message);

    const node = document.createElement('div');
    node.className = `message message-appear ${isOwn ? 'message-own' : 'message-other'}`;
    node.dataset.messageId = message.id || '';
    node.dataset.senderId = message.senderId || '';
    node.dataset.targetUserId = message.targetUserId || '';
    node.dataset.roomId = message.roomId || '';

    const header = document.createElement('div');
    header.className = 'message-header';

    const author = document.createElement('strong');
    author.textContent = sender;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const time = document.createElement('small');
    time.textContent = formatTime(message.timestamp || message.sentAt);

    meta.appendChild(time);

    if (message.isEdited) {
        const edited = document.createElement('span');
        edited.className = 'message-edited';
        edited.textContent = 'изменено';
        meta.appendChild(edited);
    }

    header.appendChild(author);
    header.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.isDeleted ? 'Сообщение удалено' : (message.content || '');

    if (message.isDeleted) {
        node.classList.add('message-deleted');
    }

    node.appendChild(header);
    node.appendChild(content);

    const attachment = buildAttachmentElement(message);
    if (attachment && !message.isDeleted) {
        node.appendChild(attachment);
    }

    const actions = buildMessageActions(node, message, isOwn);
    if (actions) {
        node.appendChild(actions);
    }

    return node;
}

function buildMessageActions(messageNode, message, isOwn) {
    if (message.isDeleted) {
        return null;
    }

    const canEdit = isOwn && !message.fileUrl;
    const canDelete = canDeleteMessage(message, isOwn);
    if (!canEdit && !canDelete) {
        return null;
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'message-action-btn';
    editButton.textContent = 'Изм.';
    editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        beginInlineEdit(messageNode).catch(console.error);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'message-action-btn danger';
    deleteButton.textContent = 'Удал.';
    deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteMessage(messageNode).catch(console.error);
    });

    if (canEdit) {
        actions.appendChild(editButton);
    }

    if (canDelete) {
        actions.appendChild(deleteButton);
    }
    return actions;
}

function canDeleteMessage(message, isOwn) {
    if (isOwn) {
        return true;
    }

    return Boolean(message.roomId && state.adminRooms.has(message.roomId));
}

function buildAttachmentElement(message) {
    if (!message?.fileUrl) {
        return null;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'message-attachment';

    const fileName = message.fileName || 'attachment';
    const fileUrl = message.fileUrl;

    if (isImageAttachment(fileName, fileUrl)) {
        const link = document.createElement('a');
        link.className = 'message-image-link';
        link.href = fileUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = fileName;

        const image = document.createElement('img');
        image.className = 'message-image-preview';
        image.src = fileUrl;
        image.alt = fileName;
        image.loading = 'lazy';

        link.appendChild(image);
        wrapper.appendChild(link);
        return wrapper;
    }

    const link = document.createElement('a');
    link.className = 'message-file-link';
    link.href = fileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = fileName;

    const icon = document.createElement('span');
    icon.className = 'message-file-icon';
    icon.textContent = '📎';

    const meta = document.createElement('div');
    meta.className = 'message-file-meta';

    const name = document.createElement('span');
    name.className = 'message-file-name';
    name.textContent = fileName;

    const size = document.createElement('span');
    size.className = 'message-file-size';
    size.textContent = formatFileSize(message.fileSize);

    meta.appendChild(name);
    meta.appendChild(size);
    link.appendChild(icon);
    link.appendChild(meta);
    wrapper.appendChild(link);

    return wrapper;
}

function isImageAttachment(fileName, fileUrl) {
    const source = `${fileName || ''} ${fileUrl || ''}`.toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(source);
}

function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) {
        return '0 Б';
    }

    if (value < 1024) {
        return `${Math.round(value)} Б`;
    }

    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} КБ`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

async function beginInlineEdit(messageNode) {
    const contentElement = messageNode.querySelector('.message-content');
    if (!contentElement || messageNode.classList.contains('message-editing')) {
        return;
    }

    const previousText = contentElement.textContent || '';
    const editInput = document.createElement('textarea');
    editInput.className = 'message-edit-input';
    editInput.value = previousText;
    editInput.rows = 2;
    editInput.maxLength = 2000;

    contentElement.replaceWith(editInput);
    messageNode.classList.add('message-editing');
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);

    const cancelEdit = () => {
        const restored = document.createElement('div');
        restored.className = 'message-content';
        restored.textContent = previousText;
        editInput.replaceWith(restored);
        messageNode.classList.remove('message-editing');
    };

    const saveEdit = async () => {
        const nextValue = editInput.value.trim();
        if (!nextValue || nextValue === previousText) {
            cancelEdit();
            return;
        }

        const messageId = messageNode.dataset.messageId;
        if (!messageId) {
            cancelEdit();
            return;
        }

        try {
            await connection.invoke('EditMessage', messageId, nextValue);
            const updated = document.createElement('div');
            updated.className = 'message-content';
            updated.textContent = nextValue;
            editInput.replaceWith(updated);
            messageNode.classList.remove('message-editing');
            ensureEditedBadge(messageNode);
        } catch (error) {
            console.error('Edit message failed:', error);
            showStatus('Не удалось изменить сообщение', 'error');
            cancelEdit();
        }
    };

    editInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            saveEdit().catch(console.error);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
        }
    });

    editInput.addEventListener('blur', () => {
        if (messageNode.classList.contains('message-editing')) {
            cancelEdit();
        }
    });
}

async function deleteMessage(messageNode) {
    const messageId = messageNode.dataset.messageId;
    if (!messageId) {
        return;
    }

    const shouldDelete = window.confirm('Удалить это сообщение?');
    if (!shouldDelete) {
        return;
    }

    try {
        await connection.invoke('DeleteMessage', messageId);
    } catch (error) {
        console.error('Delete message failed:', error);
        showStatus('Не удалось удалить сообщение', 'error');
    }
}

function applyEditedMessage(payload) {
    if (!payload?.messageId) {
        return;
    }

    const node = document.querySelector(`[data-message-id="${payload.messageId}"]`);
    if (!node) {
        return;
    }

    const content = node.querySelector('.message-content');
    if (content) {
        content.textContent = payload.content || '';
    }

    ensureEditedBadge(node);
}

function applyDeletedMessage(payload) {
    if (!payload?.messageId) {
        return;
    }

    const node = document.querySelector(`[data-message-id="${payload.messageId}"]`);
    if (!node) {
        return;
    }

    const content = node.querySelector('.message-content');
    if (content) {
        content.textContent = 'Сообщение удалено';
    }

    node.classList.add('message-deleted');
    const actions = node.querySelector('.message-actions');
    if (actions) {
        actions.remove();
    }
}

function ensureEditedBadge(messageNode) {
    const meta = messageNode.querySelector('.message-meta');
    if (!meta) {
        return;
    }

    const existing = meta.querySelector('.message-edited');
    if (existing) {
        return;
    }

    const edited = document.createElement('span');
    edited.className = 'message-edited';
    edited.textContent = 'изменено';
    meta.appendChild(edited);
}

function isOwnMessage(message) {
    const currentUserName = getCurrentUserName();
    const currentUserId = getCurrentUserId();

    return (message.senderId && message.senderId === currentUserId) ||
        (message.sender && message.sender === currentUserId) ||
        (message.senderName && message.senderName === currentUserName) ||
        (message.sender && message.sender === currentUserName);
}

function appendMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    if (message.id && container.querySelector(`[data-message-id="${message.id}"]`)) {
        return;
    }

    container.appendChild(buildMessageElement(message));
    applyMessageSearch(getSearchQuery());
}

function shouldDisplayPrivateMessage(message) {
    if (state.mode !== CHAT_MODE_PRIVATE || !state.targetUserId || !isPrivateMessage(message)) {
        return false;
    }

    const participantId = getPrivateOtherUserId(message);
    if (participantId) {
        return participantId === state.targetUserId;
    }

    // Legacy fallback when senderId is not present in payload.
    const currentUserName = getCurrentUserName();
    const senderName = message.senderName || message.sender || '';

    return senderName === currentUserName || senderName === state.targetUserName;
}

function isPublicMessage(message) {
    return !message?.isPrivate && !message?.targetUserId && !message?.roomId;
}

function isPrivateMessage(message) {
    return Boolean(message?.targetUserId) || (Boolean(message?.isPrivate) && !message?.roomId);
}

function isRoomMessage(message) {
    return Boolean(message?.roomId);
}

function getPrivateOtherUserId(message) {
    const currentUserId = getCurrentUserId();

    if (message?.senderId && message.senderId !== currentUserId) {
        return message.senderId;
    }

    if (message?.targetUserId && message.targetUserId !== currentUserId) {
        return message.targetUserId;
    }

    return null;
}

function isMessageForActiveContext(message) {
    if (state.mode === CHAT_MODE_PUBLIC) {
        return isPublicMessage(message);
    }

    if (state.mode === CHAT_MODE_PRIVATE) {
        return shouldDisplayPrivateMessage(message);
    }

    if (state.mode === CHAT_MODE_ROOM && state.activeRoomId) {
        return message?.roomId === state.activeRoomId;
    }

    return false;
}

function filterHistoryForCurrentMode(messages) {
    if (state.mode === CHAT_MODE_PUBLIC) {
        return messages.filter(isPublicMessage);
    }

    if (state.mode === CHAT_MODE_PRIVATE) {
        return messages.filter((message) => shouldDisplayPrivateMessage(message));
    }

    if (state.mode === CHAT_MODE_ROOM && state.activeRoomId) {
        return messages.filter((message) => message?.roomId === state.activeRoomId);
    }

    return [];
}

function loadMoreMessages() {
    if (state.mode !== CHAT_MODE_PUBLIC || !connection) {
        return;
    }

    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const messages = container.querySelectorAll('[data-message-id]');
    if (messages.length === 0) {
        return;
    }

    const oldestId = messages[0].dataset.messageId;
    const button = document.getElementById('loadMoreBtn');
    if (button) {
        button.disabled = true;
    }

    connection.invoke('GetMoreMessages', oldestId).catch((error) => {
        console.error(error);
        if (button) {
            button.disabled = false;
        }
    });
}

function addLoadMoreButton() {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const existing = document.getElementById('loadMoreBtn');
    if (existing) {
        existing.remove();
    }

    const button = document.createElement('button');
    button.id = 'loadMoreBtn';
    button.type = 'button';
    button.className = 'load-more-btn';
    button.textContent = 'Загрузить предыдущие сообщения';
    button.addEventListener('click', loadMoreMessages);

    container.insertBefore(button, container.firstChild);
}

function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const node = document.createElement('div');
    node.className = 'system-message';
    node.textContent = `• ${text}`;

    container.appendChild(node);
    scrollToBottom();
}

function showTypingIndicator(userName) {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) {
        return;
    }

    indicator.textContent = `${userName} печатает...`;
    indicator.style.opacity = '1';

    setTimeout(() => {
        indicator.style.opacity = '0';
    }, 2000);
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.style.opacity = '0';
    }
}

function showStatus(text, type = 'info') {
    let status = document.getElementById('connectionStatus');

    if (!status) {
        status = document.createElement('div');
        status.id = 'connectionStatus';
        status.className = 'connection-status-toast';
        document.body.appendChild(status);
    }

    status.className = `connection-status-toast ${type}`;
    status.textContent = text;
    status.style.opacity = '1';

    setTimeout(() => {
        status.style.opacity = '0';
        setTimeout(() => {
            status?.remove();
        }, 300);
    }, 2600);
}

function setConnectionState(isConnected) {
    const dot = document.getElementById('connectionStatusDot');
    if (!dot) {
        return;
    }

    dot.className = `connection-dot ${isConnected ? 'connected' : 'disconnected'}`;
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function formatTime(timestamp) {
    if (!timestamp) {
        return '';
    }

    return new Date(timestamp).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateChatTitle() {
    const title = document.getElementById('chatTitle');
    if (!title) {
        return;
    }

    if (state.mode === CHAT_MODE_PRIVATE && state.targetUserName) {
        title.textContent = `Личный чат с ${state.targetUserName}`;
        return;
    }

    if (state.mode === CHAT_MODE_ROOM && state.activeRoomName) {
        title.textContent = `Комната: ${state.activeRoomName}`;
        return;
    }

    title.textContent = 'Общий чат';
}

function updateBackButtonVisibility() {
    const backButton = document.getElementById('backToPublicChat');
    if (!backButton) {
        return;
    }

    backButton.style.display = state.mode === CHAT_MODE_PUBLIC ? 'none' : 'inline-block';
}

function clearSelection() {
    document.querySelectorAll('.user-item.active').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.room-item.active').forEach((item) => item.classList.remove('active'));
}

async function startPrivateChat(userId, userName) {
    if (!connection || !userId) {
        return;
    }

    state.mode = CHAT_MODE_PRIVATE;
    state.targetUserId = userId;
    state.targetUserName = userName;
    state.activeRoomId = null;
    state.activeRoomName = null;

    clearSelection();
    const selectedUser = document.querySelector(`.user-item[data-user-id="${escapeSelectorValue(userId)}"]`);
    selectedUser?.classList.add('active');
    clearUserUnread(userId);
    resetUnreadCount();
    clearSearchFilter();

    const container = document.getElementById('messagesContainer');
    if (container) {
        clearChildren(container);
    }

    updateChatTitle();
    updateBackButtonVisibility();

    await connection.invoke('GetPrivateHistory', userId);
}

async function startRoomChat(roomId, roomName) {
    if (!connection || !roomId) {
        return;
    }

    state.mode = CHAT_MODE_ROOM;
    state.activeRoomId = roomId;
    state.activeRoomName = roomName || 'Комната';
    state.targetUserId = null;
    state.targetUserName = null;

    clearSelection();
    const selectedRoom = document.querySelector(`.room-item[data-room-id="${escapeSelectorValue(roomId)}"]`);
    selectedRoom?.classList.add('active');
    clearRoomUnread(roomId);
    resetUnreadCount();
    clearSearchFilter();

    const container = document.getElementById('messagesContainer');
    if (container) {
        clearChildren(container);
    }

    updateChatTitle();
    updateBackButtonVisibility();

    await connection.invoke('JoinChatRoom', roomId);
}

async function switchToPublicChat(options = {}) {
    const shouldLoadHistory = Boolean(options.loadHistory);

    state.mode = CHAT_MODE_PUBLIC;
    state.targetUserId = null;
    state.targetUserName = null;
    state.activeRoomId = null;
    state.activeRoomName = null;

    clearSelection();
    resetUnreadCount();
    clearSearchFilter();
    updateChatTitle();
    updateBackButtonVisibility();

    const container = document.getElementById('messagesContainer');
    if (container) {
        clearChildren(container);
        addLoadMoreButton();
    }

    if (shouldLoadHistory && connection) {
        await connection.invoke('GetPublicHistory');
    }
}

function openCreateRoomModal() {
    const modal = document.getElementById('createRoomModal');
    if (!modal) {
        return;
    }

    modal.hidden = false;
    const nameInput = document.getElementById('roomNameInput');
    if (nameInput) {
        nameInput.focus();
    }
}

function closeCreateRoomModal() {
    const modal = document.getElementById('createRoomModal');
    const form = document.getElementById('createRoomForm');
    if (!modal || !form) {
        return;
    }

    modal.hidden = true;
    form.reset();
}

async function createRoom(event) {
    event.preventDefault();

    if (!connection) {
        return;
    }

    const nameInput = document.getElementById('roomNameInput');
    const descriptionInput = document.getElementById('roomDescriptionInput');
    if (!nameInput || !descriptionInput) {
        return;
    }

    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();

    if (!name) {
        showStatus('Введите название комнаты', 'error');
        return;
    }

    try {
        const roomId = await connection.invoke('CreateRoom', name, description || null);
        closeCreateRoomModal();
        await connection.invoke('GetUserRooms');
        await startRoomChat(roomId, name);
        showStatus('Комната создана', 'success');
    } catch (error) {
        console.error('Failed to create room:', error);
        showStatus('Не удалось создать комнату', 'error');
    }
}

function requestUserProfile(userId, userNameHint) {
    if (!connection || !userId) {
        return;
    }

    profileUserNameHint = userNameHint || '';
    connection.invoke('GetUserProfile', userId).catch((error) => {
        console.error('Failed to load user profile:', error);
        showStatus('Не удалось загрузить профиль', 'error');
    });
}

function openUserProfileModal(profile) {
    const modal = document.getElementById('userProfileModal');
    if (!modal || !profile) {
        return;
    }

    const userName = profile.userName || profileUserNameHint || 'Пользователь';
    const email = profile.email || '—';
    const status = profile.isOnline ? 'Онлайн' : 'Не в сети';
    const lastActive = profile.lastActiveAt
        ? new Date(profile.lastActiveAt).toLocaleString('ru-RU')
        : '—';

    const userNameNode = document.getElementById('profileUserName');
    const emailNode = document.getElementById('profileEmail');
    const statusNode = document.getElementById('profileStatus');
    const lastActiveNode = document.getElementById('profileLastActive');
    const writeButton = document.getElementById('profileWriteBtn');
    const kickButton = document.getElementById('profileKickBtn');

    if (userNameNode) {
        userNameNode.textContent = userName;
    }
    if (emailNode) {
        emailNode.textContent = email;
    }
    if (statusNode) {
        statusNode.textContent = status;
    }
    if (lastActiveNode) {
        lastActiveNode.textContent = lastActive;
    }
    if (writeButton) {
        writeButton.dataset.userId = profile.userId || '';
        writeButton.dataset.userName = userName;
    }

    if (kickButton) {
        const canKick = Boolean(
            state.mode === CHAT_MODE_ROOM &&
            state.activeRoomId &&
            state.adminRooms.has(state.activeRoomId) &&
            profile.userId &&
            profile.userId !== getCurrentUserId()
        );

        kickButton.dataset.userId = profile.userId || '';
        kickButton.hidden = !canKick;
        kickButton.disabled = !canKick;
    }

    modal.hidden = false;
}

function closeUserProfileModal() {
    const modal = document.getElementById('userProfileModal');
    if (modal) {
        modal.hidden = true;
    }
}

async function openChatFromProfile() {
    const writeButton = document.getElementById('profileWriteBtn');
    if (!writeButton) {
        return;
    }

    const userId = writeButton.dataset.userId;
    const userName = writeButton.dataset.userName || 'Пользователь';
    if (!userId) {
        return;
    }

    closeUserProfileModal();
    await startPrivateChat(userId, userName);
}

async function kickUserFromCurrentRoom() {
    if (!connection || !state.activeRoomId) {
        return;
    }

    const kickButton = document.getElementById('profileKickBtn');
    const targetUserId = kickButton?.dataset.userId;
    if (!targetUserId) {
        return;
    }

    try {
        await connection.invoke('KickMember', state.activeRoomId, targetUserId);
        closeUserProfileModal();
        showStatus('Пользователь удалён из комнаты', 'success');
    } catch (error) {
        console.error('Failed to kick user:', error);
        showStatus('Не удалось удалить пользователя из комнаты', 'error');
    }
}

async function handleKickedFromRoom(payload) {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    if (!roomId) {
        return;
    }

    clearRoomUnread(roomId);
    if (state.activeRoomId === roomId) {
        await switchToPublicChat({ loadHistory: true });
        showStatus('Вы удалены из комнаты', 'info');
    }

    if (connection) {
        await connection.invoke('GetUserRooms');
    }
}

function incrementUserUnread(userId) {
    if (!userId) {
        return;
    }

    state.unreadUsers[userId] = getUnreadUserCount(userId) + 1;
    updateUserUnreadBadge(userId);
}

function clearUserUnread(userId) {
    if (!userId) {
        return;
    }

    delete state.unreadUsers[userId];
    updateUserUnreadBadge(userId);
}

function getUnreadUserCount(userId) {
    if (!userId) {
        return 0;
    }

    return state.unreadUsers[userId] || 0;
}

function incrementRoomUnread(roomId) {
    if (!roomId) {
        return;
    }

    state.unreadRooms[roomId] = getUnreadRoomCount(roomId) + 1;
    updateRoomUnreadBadge(roomId);
}

function clearRoomUnread(roomId) {
    if (!roomId) {
        return;
    }

    delete state.unreadRooms[roomId];
    updateRoomUnreadBadge(roomId);
}

function getUnreadRoomCount(roomId) {
    if (!roomId) {
        return 0;
    }

    return state.unreadRooms[roomId] || 0;
}

function updateUserUnreadBadge(userId) {
    if (!userId) {
        return;
    }

    const selector = `.user-item[data-user-id="${escapeSelectorValue(userId)}"]`;
    const node = document.querySelector(selector);
    if (!node) {
        return;
    }

    syncUnreadBadgeOnNode(node, getUnreadUserCount(userId));
}

function updateRoomUnreadBadge(roomId) {
    if (!roomId) {
        return;
    }

    const selector = `.room-item[data-room-id="${escapeSelectorValue(roomId)}"]`;
    const node = document.querySelector(selector);
    if (!node) {
        return;
    }

    syncUnreadBadgeOnNode(node, getUnreadRoomCount(roomId));
}

function syncUnreadBadgeOnNode(node, count) {
    if (!node) {
        return;
    }

    const existing = node.querySelector('.unread-badge');
    if (!count || count <= 0) {
        if (existing) {
            existing.remove();
        }
        return;
    }

    const badge = existing || document.createElement('span');
    badge.className = 'unread-badge';
    badge.textContent = count > 99 ? '99+' : String(count);

    if (!existing) {
        node.appendChild(badge);
    }
}

function findRoomNameById(roomId) {
    const room = state.rooms.find((candidate) => candidate.id === roomId);
    return room?.name || null;
}

function findUserNameById(userId) {
    const node = document.querySelector(`.user-item[data-user-id="${escapeSelectorValue(userId)}"] .user-name`);
    return node?.textContent || null;
}

function escapeSelectorValue(value) {
    if (!value) {
        return '';
    }

    if (window.CSS?.escape) {
        return window.CSS.escape(value);
    }

    return value.replace(/["\\]/g, '\\$&');
}

function getSearchQuery() {
    const input = document.getElementById('messageSearchInput');
    return (input?.value || '').trim().toLowerCase();
}

function queueSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        applyMessageSearch(getSearchQuery());
    }, SEARCH_DELAY);
}

function clearSearchFilter() {
    const input = document.getElementById('messageSearchInput');
    if (input) {
        input.value = '';
    }

    applyMessageSearch('');
}

function applyMessageSearch(query) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const messageNodes = container.querySelectorAll('.message');
    if (!query) {
        messageNodes.forEach((node) => {
            node.style.display = '';
            node.classList.remove('message-match');
        });
        return;
    }

    messageNodes.forEach((node) => {
        const text = (node.textContent || '').toLowerCase();
        const isMatch = text.includes(query);
        node.style.display = isMatch ? '' : 'none';
        node.classList.toggle('message-match', isMatch);
    });
}

function setupDragAndDrop() {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    container.addEventListener('dragover', (event) => {
        event.preventDefault();
        container.classList.add('drag-over');
    });

    container.addEventListener('dragleave', (event) => {
        if (event.relatedTarget && container.contains(event.relatedTarget)) {
            return;
        }
        container.classList.remove('drag-over');
    });

    container.addEventListener('drop', (event) => {
        event.preventDefault();
        container.classList.remove('drag-over');

        const droppedFile = event.dataTransfer?.files?.[0];
        if (droppedFile) {
            uploadAndSendFile(droppedFile).catch(console.error);
        }
    });
}

function handleVisibilityChanged() {
    if (!document.hidden) {
        resetUnreadCount();
    }
}

function setupEventListeners() {
    document.getElementById('sendBtn')?.addEventListener('click', () => {
        sendMessage().catch(console.error);
    });
    document.getElementById('soundToggleBtn')?.addEventListener('click', toggleSound);

    const input = document.getElementById('messageInput');
    input?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage().catch(console.error);
        }
    });

    input?.addEventListener('input', handleTyping);
    input?.addEventListener('blur', hideTypingIndicator);

    document.getElementById('fileInput')?.addEventListener('change', (event) => {
        const file = event.target?.files?.[0];
        if (!file) {
            return;
        }

        uploadAndSendFile(file).catch(console.error);
        event.target.value = '';
    });

    document.getElementById('messageSearchInput')?.addEventListener('input', queueSearch);

    document.getElementById('backToPublicChat')?.addEventListener('click', () => {
        switchToPublicChat({ loadHistory: true }).catch(console.error);
    });

    document.getElementById('openCreateRoomBtn')?.addEventListener('click', openCreateRoomModal);
    document.getElementById('closeCreateRoomModal')?.addEventListener('click', closeCreateRoomModal);
    document.getElementById('createRoomForm')?.addEventListener('submit', createRoom);

    document.getElementById('createRoomModal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'createRoomModal') {
            closeCreateRoomModal();
        }
    });

    document.getElementById('closeUserProfileModal')?.addEventListener('click', closeUserProfileModal);
    document.getElementById('profileWriteBtn')?.addEventListener('click', () => {
        openChatFromProfile().catch(console.error);
    });
    document.getElementById('profileKickBtn')?.addEventListener('click', () => {
        kickUserFromCurrentRoom().catch(console.error);
    });

    document.getElementById('userProfileModal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'userProfileModal') {
            closeUserProfileModal();
        }
    });

    document.addEventListener('visibilitychange', handleVisibilityChanged);
    window.addEventListener('focus', resetUnreadCount);
}
