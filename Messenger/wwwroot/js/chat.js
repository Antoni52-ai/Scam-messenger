let connection;
let typingTimer;
const TYPING_DELAY = 1000;

function getCurrentUserName() {
    return window.chatConfig?.currentUserName || '';
}

document.addEventListener('DOMContentLoaded', async () => {
    await initializeSignalR();
    setupEventListeners();
    scrollToBottom();
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
        showStatus('Подключено', 'success');

        const dot = document.getElementById('connectionStatusDot');
        if (dot) {
            dot.className = 'connection-dot connected';
        }

        await connection.invoke('JoinRoom', 'general');
        await connection.invoke('GetUserList');
    } catch (error) {
        console.error('SignalR connection failed:', error);
        showStatus('Ошибка подключения', 'error');

        const dot = document.getElementById('connectionStatusDot');
        if (dot) {
            dot.className = 'connection-dot disconnected';
        }

        setTimeout(initializeSignalR, 5000);
    }
}

function registerSignalRHandlers() {
    connection.on('UserList', updateUserList);
    connection.on('OnlineUsersUpdated', updateUserList);

    connection.on('NewMessage', (message) => {
        appendMessage(message);
        scrollToBottom();
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

    connection.on('MessageHistory', (messages) => {
        const container = document.getElementById('messagesContainer');
        if (!container) {
            return;
        }

        const fragment = document.createDocumentFragment();
        messages.forEach((msg) => {
            fragment.appendChild(buildMessageElement(msg));
        });

        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) {
            container.insertBefore(fragment, loadMoreBtn.nextSibling);
        } else {
            container.insertBefore(fragment, container.firstChild);
        }

        scrollToBottom();
    });

    connection.on('OlderMessages', (messages) => {
        const container = document.getElementById('messagesContainer');
        if (!container) {
            return;
        }

        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (messages.length === 0) {
            if (loadMoreBtn) {
                loadMoreBtn.style.display = 'none';
            }
            return;
        }

        const fragment = document.createDocumentFragment();
        messages.forEach((msg) => {
            fragment.appendChild(buildMessageElement(msg));
        });

        const oldHeight = container.scrollHeight;
        container.insertBefore(fragment, loadMoreBtn ? loadMoreBtn.nextSibling : container.firstChild);
        container.scrollTop = container.scrollHeight - oldHeight;

        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
        }
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
        if (window.chatConfig.targetUserId) {
            await connection.invoke('SendPrivateMessage', window.chatConfig.targetUserId, content);
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

    connection.invoke('SendTyping', null);

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        // Typing timeout is intentionally passive on the client.
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

function clearChildren(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

function buildUserItem(userId, userName) {
    const li = document.createElement('li');
    li.className = 'user-item';

    const avatar = document.createElement('div');
    avatar.className = 'user-avatar';
    avatar.textContent = getInitials(userName);

    const dot = document.createElement('span');
    dot.className = 'user-status';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = userName;

    li.appendChild(avatar);
    li.appendChild(dot);
    li.appendChild(nameSpan);

    if (userId) {
        li.onclick = () => startPrivateChat(userId, userName);
    }

    return li;
}

function updateUserList(users) {
    const onlineList = document.getElementById('onlineUsers');
    const onlineCount = document.getElementById('onlineCount');

    if (!onlineList || !onlineCount) {
        return;
    }

    clearChildren(onlineList);

    const currentUserName = getCurrentUserName();
    const otherUsers = (users || []).filter((u) => u.userName !== currentUserName);

    otherUsers.forEach((user) => {
        onlineList.appendChild(buildUserItem(user.userId, user.userName));
    });

    onlineCount.textContent = String(otherUsers.length);
}

function addOnlineUser(userId, userName) {
    const onlineList = document.getElementById('onlineUsers');
    if (!onlineList || userName === getCurrentUserName()) {
        return;
    }

    const existing = Array.from(onlineList.querySelectorAll('.user-name')).some((el) => el.textContent === userName);

    if (!existing) {
        onlineList.appendChild(buildUserItem(userId, userName));

        const count = document.getElementById('onlineCount');
        if (count) {
            const current = Number.parseInt(count.textContent || '0', 10) || 0;
            count.textContent = String(current + 1);
        }
    }
}

function removeOnlineUser(userName) {
    const onlineList = document.getElementById('onlineUsers');
    if (!onlineList) {
        return;
    }

    const items = onlineList.querySelectorAll('.user-item');
    items.forEach((item) => {
        const nameEl = item.querySelector('.user-name');
        if (nameEl && nameEl.textContent === userName) {
            item.remove();
        }
    });

    const count = document.getElementById('onlineCount');
    if (count) {
        const current = Number.parseInt(count.textContent || '0', 10) || 0;
        count.textContent = String(Math.max(0, current - 1));
    }
}

function buildMessageElement(msg) {
    const currentUserName = getCurrentUserName();
    const sender = msg.senderName || msg.sender || 'Пользователь';
    const isOwn = sender === currentUserName || msg.sender === currentUserName;

    const div = document.createElement('div');
    div.className = `message message-appear ${isOwn ? 'message-own' : 'message-other'}`;
    div.dataset.messageId = msg.id;

    const header = document.createElement('div');
    header.className = 'message-header';

    const author = document.createElement('strong');
    author.textContent = sender;

    const time = document.createElement('small');
    time.textContent = formatTime(msg.timestamp || msg.sentAt);

    header.appendChild(author);
    header.appendChild(time);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(content);

    return div;
}

function appendMessage(msg) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    if (msg.id && container.querySelector(`[data-message-id="${msg.id}"]`)) {
        return;
    }

    container.appendChild(buildMessageElement(msg));
}

function loadMoreMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container || !connection) {
        return;
    }

    const messages = container.querySelectorAll('[data-message-id]');
    if (messages.length === 0) {
        return;
    }

    const oldestId = messages[0].dataset.messageId;
    const btn = document.getElementById('loadMoreBtn');
    if (btn) {
        btn.disabled = true;
    }

    connection.invoke('GetMoreMessages', oldestId).catch(console.error);
}

function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        return;
    }

    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = `• ${text}`;

    container.appendChild(div);
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
    let statusEl = document.getElementById('connectionStatus');

    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'connectionStatus';
        statusEl.className = 'connection-status-toast';
        document.body.appendChild(statusEl);
    }

    statusEl.className = `connection-status-toast ${type}`;
    statusEl.textContent = text;
    statusEl.style.opacity = '1';

    setTimeout(() => {
        statusEl.style.opacity = '0';
        setTimeout(() => {
            statusEl.remove();
        }, 300);
    }, 2600);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function formatTime(isoString) {
    if (!isoString) {
        return '';
    }

    return new Date(isoString).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
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

    const btn = document.createElement('button');
    btn.id = 'loadMoreBtn';
    btn.type = 'button';
    btn.className = 'load-more-btn';
    btn.textContent = 'Загрузить предыдущие сообщения';
    btn.onclick = loadMoreMessages;

    container.insertBefore(btn, container.firstChild);
}

function setupEventListeners() {
    document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

    const input = document.getElementById('messageInput');
    input?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    input?.addEventListener('input', handleTyping);
    input?.addEventListener('blur', hideTypingIndicator);

    const backBtn = document.getElementById('backToPublicChat');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            returnToPublicChat();
            backBtn.style.display = 'none';
        });
    }

    addLoadMoreButton();
}

function startPrivateChat(userId, userName) {
    window.chatConfig.targetUserId = userId;
    window.chatConfig.targetUserName = userName;

    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) {
        chatTitle.textContent = `Личный чат с ${userName}`;
    }

    const container = document.getElementById('messagesContainer');
    if (container) {
        clearChildren(container);
        const note = document.createElement('div');
        note.className = 'system-message';
        note.textContent = `• Начат личный чат с ${userName}`;
        container.appendChild(note);
    }

    const backBtn = document.getElementById('backToPublicChat');
    if (backBtn) {
        backBtn.style.display = 'inline-block';
    }
}

function returnToPublicChat() {
    window.chatConfig.targetUserId = null;
    window.chatConfig.targetUserName = null;

    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) {
        chatTitle.textContent = 'Общий чат';
    }

    const container = document.getElementById('messagesContainer');
    if (container) {
        clearChildren(container);
    }

    addLoadMoreButton();
    connection.invoke('GetPublicHistory').catch(console.error);
}
