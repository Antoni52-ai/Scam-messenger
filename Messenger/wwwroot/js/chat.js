// 🔹 Глобальные переменные
let connection;
let typingTimer;
const TYPING_DELAY = 1000;

// 🔹 Инициализация при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    await initializeSignalR();
    setupEventListeners();
    scrollToBottom();
});

// 🔹 Подключение к SignalR
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
        console.log('✅ SignalR connected');
        showStatus('Подключено', 'success');

        // 🔥 Запрашиваем список пользователей ПОСЛЕ успешного подключения
        await connection.invoke('GetUserList');
        console.log('📋 User list requested');

    } catch (err) {
        console.error('❌ SignalR connection failed:', err);
        showStatus('Ошибка подключения', 'error');
        setTimeout(initializeSignalR, 5000);
    }
}

function registerSignalRHandlers() {

    // Обработка списка пользователей
    connection.on('UserList', (users) => {
        updateUserList(users);
    });
    // 📨 Новое сообщение
    connection.on('NewMessage', (message) => {
        appendMessage(message);
        scrollToBottom();
    });

    // 👤 Пользователь подключился
    connection.on('UserJoined', (user) => {
        addOnlineUser(user.userName);
        showSystemMessage(`${user.userName} присоединился`);
    });

    // 👋 Пользователь отключился
    connection.on('UserLeft', (user) => {
        removeOnlineUser(user.userName);
        showSystemMessage(`${user.userName} покинул чат`);
    });

    // ✍️ Кто-то печатает
    connection.on('UserTyping', (userName) => {
        showTypingIndicator(userName);
    });

    // 🔄 Обновление списка онлайн
    connection.on('OnlineUsersUpdated', (users) => {
        updateOnlineList(users);
    });

    // ⚠️ Системные сообщения
    connection.on('SystemMessage', (data) => {
        showSystemMessage(data.text);
    });
}

// 🔹 Отправка сообщения
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content || !connection) return;

    try {
        if (window.chatConfig.targetUserId) {
            // Приватное сообщение
            await connection.invoke('SendPrivateMessage', window.chatConfig.targetUserId, content);
            console.log(`Sent private message to ${window.chatConfig.targetUserName}`);
        } else {
            // Общее сообщение
            await connection.invoke('SendMessage', content);
        }

        input.value = '';
        hideTypingIndicator();
    } catch (err) {
        console.error('Failed to send:', err);
        showStatus('❌ Не удалось отправить', 'error');
    }
}


// 🔹 Индикатор набора
function handleTyping() {
    if (!connection) return;

    connection.invoke('SendTyping', null);

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        // Перестали печатать
    }, TYPING_DELAY);
}

// 🔹 Обновление списка онлайн-пользователей
function updateOnlineList(users) {
    const onlineList = document.getElementById('onlineUsers');
    const onlineCount = document.getElementById('onlineCount');

    if (!onlineList || !onlineCount) return;

    onlineList.innerHTML = '';

    if (users && Array.isArray(users)) {
        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'user-item';
            li.innerHTML = `
                <span class="user-status online"></span>
                <span class="user-name">${escapeHtml(user.userName)}</span>
            `;
            onlineList.appendChild(li);
        });
        onlineCount.textContent = users.length;
    }
}

// 🔹 Добавить пользователя в список онлайн
function addOnlineUser(userName) {
    const onlineList = document.getElementById('onlineUsers');
    if (!onlineList) return;

    // Проверка, нет ли уже такого пользователя
    const existing = Array.from(onlineList.querySelectorAll('.user-name'))
        .some(el => el.textContent === userName);

    if (!existing) {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.innerHTML = `
            <span class="user-status online"></span>
            <span class="user-name">${escapeHtml(userName)}</span>
        `;
        onlineList.appendChild(li);

        // Обновить счётчик
        const count = document.getElementById('onlineCount');
        if (count) {
            count.textContent = parseInt(count.textContent) + 1;
        }
    }
}

// 🔹 Удалить пользователя из списка онлайн
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

    // Обновить счётчик
    const count = document.getElementById('onlineCount');
    if (count) {
        const current = parseInt(count.textContent) || 0;
        count.textContent = Math.max(0, current - 1);
    }
}

// 🔹 Показать сообщение в чате
function appendMessage(msg) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const isOwn = msg.sender === (window.chatConfig?.currentUserName || '');

    const msgEl = document.createElement('div');
    msgEl.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
    msgEl.innerHTML = `
        <div class="message-header">
            <strong>${escapeHtml(msg.sender)}</strong>
            <small>${formatTime(msg.timestamp)}</small>
        </div>
        <div class="message-content">${escapeHtml(msg.content)}</div>
    `;

    container.appendChild(msgEl);
}

// 🔹 Показать системное сообщение
function showSystemMessage(text) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = `• ${text}`;
    container.appendChild(div);
    scrollToBottom();
}

// 🔹 Показать индикатор набора
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

// 🔹 Показать статус подключения
function showStatus(text, type) {
    let statusEl = document.getElementById('connectionStatus');

    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'connectionStatus';
        statusEl.style.cssText = 'position:fixed;top:10px;right:10px;padding:8px 16px;border-radius:4px;z-index:1000;font-size:14px;';
        document.body.appendChild(statusEl);
    }

    statusEl.textContent = text;
    statusEl.style.backgroundColor = type === 'success' ? '#4caf50' :
        type === 'error' ? '#f44336' : '#2196f3';
    statusEl.style.color = 'white';

    setTimeout(() => {
        statusEl.style.opacity = '0';
        setTimeout(() => statusEl.remove(), 300);
    }, 3000);
}

// 🔹 Вспомогательные функции
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

// 🔹 Обработчики DOM
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

    // 🔥 ДОБАВЬ ЭТО:
    const backBtn = document.getElementById('backToPublicChat');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            returnToPublicChat();
            backBtn.style.display = 'none';
        });
    }
}

// Обновление списка пользователей онлайн
function updateUserList(users) {
    const onlineList = document.getElementById('onlineUsers');
    const onlineCount = document.getElementById('onlineCount');

    if (!onlineList || !onlineCount) return;

    onlineList.innerHTML = '';

    // Фильтруем текущего пользователя
    const currentUserName = window.chatConfig?.currentUserName;
    const otherUsers = users.filter(u => u.userName !== currentUserName);

    otherUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.style.cursor = 'pointer';
        li.style.padding = '8px';
        li.style.borderRadius = '4px';
        li.style.marginBottom = '4px';
        li.innerHTML = `
            <span class="user-status online" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4caf50;margin-right:8px;"></span>
            <span class="user-name">${escapeHtml(user.userName)}</span>
        `;

        // Клик для начала приватного чата
        li.onclick = () => startPrivateChat(user.userId, user.userName);

        onlineList.appendChild(li);
    });

    onlineCount.textContent = otherUsers.length;
}

// Начало приватного чата
function startPrivateChat(userId, userName) {
    window.chatConfig.targetUserId = userId;
    window.chatConfig.targetUserName = userName;

    // Обновляем заголовок чата
    const chatTitle = document.getElementById('chatTitle');
    if (chatTitle) {
        chatTitle.textContent = `Приватный чат с ${userName}`;
        chatTitle.style.color = '#007aff';
    }

    // Очищаем сообщения
    const container = document.getElementById('messagesContainer');
    if (container) {
        container.innerHTML = '<div class="system-message">Начало приватного чата с ' + userName + '</div>';
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

    // Здесь можно загрузить последние сообщения из общего чата
    console.log('Returned to public chat');
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
        li.innerHTML = `
            <span class="user-status online" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4caf50;margin-right:8px;"></span>
            <span class="user-name">${escapeHtml(user.userName)}</span>
        `;

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
        chatTitle.textContent = `Приватный чат с ${userName}`;
        chatTitle.style.color = '#007aff';
    }

    const container = document.getElementById('messagesContainer');
    if (container) {
        container.innerHTML = '<div class="system-message">Начало приватного чата с ' + userName + '</div>';
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

    console.log('Returned to public chat');
}