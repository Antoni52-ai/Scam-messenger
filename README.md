# ⚡ SCAM MESSENGER

Real-time web messenger built with ASP.NET Core and SignalR, featuring a retro-futuristic cyberpunk design.

![.NET](https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791?logo=postgresql&logoColor=white)
![SignalR](https://img.shields.io/badge/SignalR-8.0-512BD4)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

**Messaging**
- Public chat room with real-time message broadcasting
- Private one-on-one messaging between users
- Message history with pagination ("Load more")
- Messages persisted to PostgreSQL
- 2000 character limit, XSS-safe input sanitization

**Real-time**
- Instant message delivery via SignalR WebSockets
- Online user list with live updates
- Typing indicators ("User is typing...")
- Join/leave system notifications
- Auto-reconnect with exponential backoff

**Auth**
- Registration & login with ASP.NET Identity
- Session-based authentication
- All chat endpoints require authorization

**UI / Design**
- Cyberpunk aesthetic with neon glow effects
- Monospace fonts (Share Tech Mono, Orbitron)
- CRT scanline overlay
- Holographic animated backgrounds
- Responsive layout (desktop & mobile)
- Own messages vs. others visually distinct

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | ASP.NET Core 9, C# |
| Real-time | SignalR |
| Database | PostgreSQL + EF Core 9 (Npgsql) |
| Auth | ASP.NET Identity |
| Frontend | Razor Views, Vanilla JS, CSS3 |
| Container | Docker (for PostgreSQL) |

---

## Quick Start

### Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL)

### 1. Clone

```bash
git clone https://github.com/Antoni52-ai/Scam-messenger.git
cd Scam-messenger
```

### 2. Start PostgreSQL

```bash
docker run -d \
  --name postgres \
  -p 5432:5432 \
  -e POSTGRES_USER=messenger \
  -e POSTGRES_PASSWORD=messenger \
  -e POSTGRES_DB=messenger \
  postgres:17
```

### 3. Configure connection string

```bash
cd Messenger
dotnet user-secrets set "ConnectionStrings:DefaultConnection" \
  "Host=localhost;Port=5432;Database=messenger;Username=messenger;Password=messenger"
```

### 4. Run

```bash
dotnet run --launch-profile http
```

Open **http://localhost:5105** in your browser.

Database migrations are applied automatically on startup.

---

## Project Structure

```
Messenger/
├── Controllers/
│   ├── AccountController.cs    # Login, Register, Logout
│   └── ChatController.cs       # Main chat page
├── Hubs/
│   └── ChatHub.cs              # SignalR hub (messages, presence, typing)
├── Services/
│   ├── MessageService.cs       # Message persistence (EF Core)
│   └── Interfaces/
│       └── IMessageService.cs
├── Models/
│   ├── Entity/                 # EF Core entities
│   │   ├── ChatMessage.cs
│   │   ├── ApplicationUser.cs
│   │   └── ChatRoom.cs
│   ├── DTO/
│   │   └── MessageDto.cs
│   └── ViewModel/
│       └── ChatViewModel.cs
├── Data/
│   └── ApplicationDbContext.cs
├── Views/
│   ├── Chat/Index.cshtml       # Main chat UI
│   └── Account/                # Login & Register pages
├── wwwroot/
│   ├── js/chat.js              # Frontend chat logic
│   └── css/
│       ├── site.css            # Global cyberpunk theme
│       └── chat.css            # Chat-specific styles
└── Program.cs                  # App entry point, DI, middleware
```

---

## SignalR API

### Client -> Server

| Method | Parameters | Description |
|--------|-----------|-------------|
| `SendMessage` | `content` | Send public message |
| `SendPrivateMessage` | `targetUserId, content` | Send private message |
| `SendTyping` | `targetUserId?` | Broadcast typing indicator |
| `JoinRoom` | `roomName` | Join a chat room |
| `GetMoreMessages` | `lastMessageId` | Load older messages |
| `GetPublicHistory` | — | Reload public chat history |
| `GetUserList` | — | Request online users |

### Server -> Client

| Event | Payload | Description |
|-------|---------|-------------|
| `NewMessage` | `MessageDto` | New message received |
| `MessageHistory` | `ChatMessage[]` | Initial message history |
| `OlderMessages` | `ChatMessage[]` | Paginated older messages |
| `UserJoined` | `{userName, userId}` | User connected |
| `UserLeft` | `{userName, userId}` | User disconnected |
| `OnlineUsersUpdated` | `[{userName, userId}]` | Full user list |
| `UserTyping` | `userName` | Typing indicator |
| `SystemMessage` | `{text, timestamp}` | System notification |

---

## Configuration

| Setting | Source | Description |
|---------|--------|-------------|
| `ConnectionStrings:DefaultConnection` | User Secrets / env var | PostgreSQL connection string |
| `AllowedOrigins` | appsettings.json | CORS allowed origins |
| `ASPNETCORE_ENVIRONMENT` | launchSettings.json | `Development` / `Production` |

> Secrets are **never** stored in source code. Use `dotnet user-secrets` for development and environment variables for production.

---

## License

MIT
