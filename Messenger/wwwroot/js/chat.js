// Глобальные переменные
let connection;
let typingTimer;
const TYPING_DELAY = 1000;

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    await initializeSignalR();
    setupEventListeners();
    scrollToBottom();
});

// Подключение к SignalR
async function initializeSignalR() {
    connection = new signalR.HubConnectionBuilder()
        .withUrl('/hub/chat', {
            withCredentials: false
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();

    registerSignalRHandlers();

    try {
        await connection.start();
        console.log('SignalR connected');
        showStatus('Подключено', 'success');
        const dot = document.getElementById('connectionStatusDot');
        if (dot) dot.className = 'connection-dot connected';

        await connection.invoke('GetUserList');
        console.log('User list requested');

    } catch (err) {
        console.error('SignalR connection failed:', err);
        showStatus('Ошибка подключения', 'error');
        const errDot = document.getElementById('connectionStatusDot');
        if (errDot) errDot.className = 'connection-dot disconnected';
        setTimeout(initializeSignalR, 5000);
    }
}

function registerSignalRHandlers() {

    // Обработка списка пользователей
    connection.on('UserList', (users) => {
        updateUserList(users);
    });

    // Новое сообщение
    connection.on('NewMessage', (message) => {
        appendMessage(message);
        scrollToBottom();
    });

    // Пользователь подключился
    connection.on('UserJoined', (user) => {
        addOnlineUser(user.userName);
        showSystemMessage(`${user.userName} присоединился`);
    });

    // Пользователь отключился
    connection.on('UserLeft', (user) => {
        removeOnlineUser(user.userName);
        showSystemMessage(`${user.userName} покинул чат`);
    });

    // Кто-то печатает
    connection.on('UserTyping', (userName) => {
        showTypingIndicator(userName);
    });

    // Обновление списка онлайн
    connection.on('OnlineUsersUpdated', (users) => {
        updateOnlineList(users);
    });

    // Системные сообщения
    connection.on('SystemMessage', (data) => {
        showSystemMessage(data.text);
    });

    // История сообщений при входе
    connection.on('MessageHistory', (messages) => {
        const container = document.getElementById('messagesContainer');
        if (!container) return;
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => {
            const el = buildMessageElement(msg);
            fragment.appendChild(el);
        });
        container.insertBefore(fragment, container.firstChild);
    });

    // Подгрузка старых сообщений
    connection.on('OlderMessages', (messages) => {
        const container = document.getElementById('messagesContainer');
        if (!container) return;
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (messages.length === 0) {
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }
        const fragment = document.createDocumentFragment();
        messages.forEach(msg => fragment.appendChild(buildMessageElement(msg)));
        const oldHeight = container.scrollHeight;
        container.insertBefore(fragment, loadMoreBtn ? loadMoreBtn.nextSibling : container.firstChild);
        container.scrollTop = container.scrollHeight - oldHeight;
        if (loadMoreBtn) loadMoreBtn.disabled = false;
    });
}

// Отправка сообщения
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content || !connection) return;

    try {
        if (window.chatConfig.targetUserId) {
            await connection.invoke('SendPrivateMessage', window.chatConfig.targetUserId, content);
            console.log(`Sent private message to ${window.chatConfig.targetUserName}`);
        } else {
            await connection.invoke('SendMessage', content);
        }

        input.value = '';
        hideTypingIndicator();
    } catch (err) {
        console.error('Failed to send:', err);
        showStatus('Не удалось отправить', 'error');
    }
}


// Индикатор набора
function handleTyping() {
    if (!connection) return;

    connection.invoke('SendTyping', null);

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        // Перестали печатать
    }, TYPING_DELAY);
}

// Обновление списка онлайн-пользователей
function updateOnlineList(users) {
    const onlineList = document.getElementById('onlineUsers');
    const onlineCount = document.getElementById('onlineCount');

    if (!onlineList || !onlineCount) return;

    onlineList.innerHTML = '';

    if (users && Array.isArray(users)) {
        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'user-item';

            const statusSpan = document.createElement('span');
            statusSpan.className = 'user-status online';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'user-name';
            nameSpan.textContent = user.userName;

            li.appendChild(statusSpan);
            li.appendChild(nameSpan);
            onlineList.appendChild(li);
        });
        onlineCount.textContent = users.length;
    }
}

// Добавить пользователя в список онлайн
function addOnlineUser(userName) {
    const onlineList = document.getElementById('onlineUsers');
    if (!onlineList) return;

    const existing = Array.from(onlineList.querySelectorAll('.user-name'))
        .some(el => el.textContent === userName);

    if (!existing) {
        const li = document.createElement('li');
        li.className = 'user-item';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'user-status online';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = userName;

        li.appendChild(statusSpan);
        li.appendChild(nameSpan);
        onlineList.appendChild(li);

        const count = document.getElementById('onlineCount');
        if (count) {
            count.textContent = parseInt(count.textContent) + 1;
        }
    }
}

// Удалить пользователя из списка онлайн
function removeOnlineUser(userName) {
    const onlineList = document.getElementById('onlineUsers');
    if (!onlineList) return;

    const items = onlineList.querySelectorAll('.user-item');
    items.forEach(item => {
        const nameEl = item.querySelector('.user-name');
        if (nameEl && nameEl.textContent === userName) {
            item.remove();
        }
    });

    const count = document.getElementById('onlineCount');
    if (count) {
        const current = parseInt(count.textContent) || 0;
        count.textContent = Math.max(0, current - 1);
    }
}

// Построение DOM-элемента сообщения
function buildMessageElement(msg) {
    const isOwn = msg.sender === (window.chatConfig?.currentUserName || '') ||
                  msg.senderName === (window.chatConfig?.currentUserName || '');
    const div = document.createElement('div');
    div.className = `message message-appear ${isOwn ? 'message-own' : 'message-other'}`;
    div.dataset.messageId = msg.id;

    const header = document.createElement('div');
    header.className = 'message-header';

    const strong = document.createElement('strong');
    strong.textContent = msg.senderName || msg.sender;

    const small = document.createElement('small');
    small.textContent = formatTime(msg.timestamp || msg.sentAt);

    header.appendChild(strong);
    header.appendChild(small);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    div.appendChild(header);
    div.appendChild(content);
    return div;
}

// Показать сообщение в чате
function appendMessage(msg) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    // Deduplication check
    if (msg.id && container.querySelector(`[data-message-id="${msg.id}"]`)) return;
    container.appendChild(buildMessageElement(msg));
}

// Загрузить старые сообщения
function loadMoreMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    const messages = container.querySelectorAll('[data-message-id]');
    if (messages.length === 0) return;
    const oldestId = messages[0].dataset.messageId;
    const btn = document.getElementById('loadMoreBtn');
    if (btn) btn.disabled = true;
    connection.invoke('GetMoreMessages', oldestId).catch(console.error);
}

// Показать системное сообщение
function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = '\u2022 ' + text;
    container.appendChild(div);
    scrollToBottom();
}

// Показать индикатор набора
function showTypingIndicator(userName) {
    const el = document.getElementById('typingIndicator');
    if (el) {
        el.textContent = `${userName} печатает...`;
        el.style.opacity = '1';
        setTimeout(() => {
            el.style.opacity = '0';
        }, 2000);
    }
}

function hideTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el) {
        el.style.opacity = '0';
    }
}

// Показать статус подключения
function showStatus(text, type) {
    let statusEl = document.getElementById('connectionStatus');

    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'connectionStatus';
        statusEl.style.cssText = 'position:fixed;top:10px;right:10px;padding:8px 16px;border-radius:4px;z-index:1000;font-size:14px;font-family:Share Tech Mono,monospace;border:1px solid;';
        document.body.appendChild(statusEl);
    }

    statusEl.textContent = text;
    statusEl.style.backgroundColor = type === 'success' ? 'rgba(0,255,136,0.15)' :
        type === 'error' ? 'rgba(255,0,170,0.15)' : 'rgba(0,240,255,0.15)';
    statusEl.style.color = type === 'success' ? '#00ff88' :
        type === 'error' ? '#ff00aa' : '#00f0ff';
    statusEl.style.borderColor = type === 'success' ? '#00ff88' :
        type === 'error' ? '#ff00aa' : '#00f0ff';

    setTimeout(() => {
        statusEl.style.opacity = '0';
        setTimeout(() => statusEl.remove(), 300);
    }, 3000);
}

// Вспомогательные функции
function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Вставка кнопки "Загрузить ещё"
function addLoadMoreButton() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    // Remove existing button if any
    const existing = document.getElementById('loadMoreBtn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = 'loadMoreBtn';
    btn.textContent = '\u2B06 Загрузить ещё';
    btn.style.cssText = 'display:block;width:100%;padding:8px;margin-bottom:8px;background:rgba(0,240,255,0.05);border:1px solid rgba(0,240,255,0.2);border-radius:4px;cursor:pointer;font-size:13px;color:#00f0ff;font-family:Share Tech Mono,monospace;';
    btn.onclick = loadMoreMessages;
    container.insertBefore(btn, container.firstChild);
}

// Обработчики DOM
function setupEventListeners() {
    document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

    const input = document.getElementById('messageInput');
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
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

// Обновление списка пользователей онлайн
function updateUserList(users) {
    const onlineList = document.getElementById('onlineUsers');
    const onlineCount = document.getElementById('onlineCount');

    if (!onlineList || !onlineCount) return;

    onlineList.innerHTML = '';

    const currentUserName = window.chatConfig?.currentUserName;
    const otherUsers = users.filter(u => u.userName !== currentUserName);

    otherUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.style.cursor = 'pointer';
        li.style.padding = '8px';
        li.style.borderRadius = '4px';
        li.style.marginBottom = '4px';

        const statusSpan = document.createElement('span');
        statusSpan.className = 'user-status online';
        statusSpan.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#4caf50;margin-right:8px;';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = user.userName;

        li.appendChild(statusSpan);
        li.appendChild(nameSpan);

        li.onclick = () => startPrivateChat(user.userId, user.userName);
        onlineList.appendChild(li);
    });

    onlineCount.textContent = otherUsers.length;
}

// Начало приватного чата
function startPrivateChat(userId, userName) {
    window.chatConfig.targetUserId = userId;
    window.chatConfig.targetUserName = userName;

    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) {
        chatTitle.textContent = 'Приватный чат с ' + userName;
        chatTitle.style.color = '#ff00aa';
    }

    const container = document.getElementById('messagesContainer');
    if (container) {
        container.textContent = '';
        const sysMsg = document.createElement('div');
        sysMsg.className = 'system-message';
        sysMsg.textContent = 'Начало приватного чата с ' + userName;
        container.appendChild(sysMsg);
    }

    // Показываем кнопку "Вернуться"
    const backBtn = document.getElementById('backToPublicChat');
    if (backBtn) {
        backBtn.style.display = 'inline-block';
    }

    console.log(`Started private chat with ${userName} (${userId})`);
}

// Вернуться в общий чат
function returnToPublicChat() {
    window.chatConfig.targetUserId = null;
    window.chatConfig.targetUserName = null;

    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) {
        chatTitle.textContent = 'Общий чат';
        chatTitle.style.color = '';
    }

    const container = document.getElementById('messagesContainer');
    if (container) container.textContent = '';

    // Re-add load more button
    addLoadMoreButton();

    connection.invoke('GetPublicHistory').catch(console.error);
    console.log('Returned to public chat');
}
