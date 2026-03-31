let connection;
let typingTimer;
const TYPING_DELAY = 1000;

const CHAT_MODE_PUBLIC = 'public';
const CHAT_MODE_PRIVATE = 'private';
const CHAT_MODE_ROOM = 'room';

const state = {
    mode: CHAT_MODE_PUBLIC,
    targetUserId: null,
    targetUserName: null,
    activeRoomId: null,
    activeRoomName: null,
    rooms: []
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

document.addEventListener('DOMContentLoaded', async () => {
    normalizeInitialConfig();
    setupEventListeners();
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
        if (isPublicMessage(message) && state.mode === CHAT_MODE_PUBLIC) {
            appendMessage(message);
            scrollToBottom();
            return;
        }

        if (shouldDisplayPrivateMessage(message)) {
            appendMessage(message);
            scrollToBottom();
        }
    });

    connection.on('RoomMessage', (message) => {
        if (state.mode === CHAT_MODE_ROOM && message?.roomId === state.activeRoomId) {
            appendMessage(message);
            scrollToBottom();
        }
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

    connection.on('UserJoined', (user) => {
        addOnlineUser(user.userId, user.userName);
        showSystemMessage(`${user.userName} присоединился к чату`);
    });

    connection.on('UserLeft', (user) => {
        removeOnlineUser(user.userName);
        showSystemMessage(`${user.userName} покинул чат`);
    });

    connection.on('UserTyping', (userName) => {
        showTypingIndicator(userName);
    });

    connection.on('SystemMessage', (data) => {
        showSystemMessage(data.text);
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
    avatar.className = 'user-avatar';
    avatar.textContent = getInitials(userName);

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

    return item;
}

function updateUserList(users) {
    const list = document.getElementById('onlineUsers');
    const count = document.getElementById('onlineCount');
    if (!list || !count) {
        return;
    }

    clearChildren(list);

    const currentUserName = getCurrentUserName();
    const otherUsers = (users || []).filter((user) => user.userName !== currentUserName);

    otherUsers.forEach((user) => {
        list.appendChild(buildUserItem(user.userId, user.userName));
    });

    count.textContent = String(otherUsers.length);
}

function addOnlineUser(userId, userName) {
    const list = document.getElementById('onlineUsers');
    if (!list || userName === getCurrentUserName()) {
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

function removeOnlineUser(userName) {
    const list = document.getElementById('onlineUsers');
    if (!list) {
        return;
    }

    const item = Array.from(list.querySelectorAll('.user-item')).find((node) => {
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

    if (isOwn && !message.isDeleted) {
        node.appendChild(buildMessageActions(node));
    }

    return node;
}

function buildMessageActions(messageNode) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'message-action-btn';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        beginInlineEdit(messageNode).catch(console.error);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'message-action-btn danger';
    deleteButton.textContent = 'Del';
    deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteMessage(messageNode).catch(console.error);
    });

    actions.appendChild(editButton);
    actions.appendChild(deleteButton);
    return actions;
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
}

function shouldDisplayPrivateMessage(message) {
    if (state.mode !== CHAT_MODE_PRIVATE || !state.targetUserId || isPublicMessage(message)) {
        return false;
    }

    const currentUserId = getCurrentUserId();
    const senderId = message.senderId || null;
    if (senderId && currentUserId) {
        const participantId = senderId === currentUserId ? message.targetUserId : senderId;
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
    const selectedUser = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    selectedUser?.classList.add('active');

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
    const selectedRoom = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
    selectedRoom?.classList.add('active');

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

function setupEventListeners() {
    document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

    const input = document.getElementById('messageInput');
    input?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage().catch(console.error);
        }
    });

    input?.addEventListener('input', handleTyping);
    input?.addEventListener('blur', hideTypingIndicator);

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
}
