using Messenger.Data;
using Messenger.Models.DTO;
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using System.Security.Claims;

namespace Messenger.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly IMessageService _messageService;
    private readonly ApplicationDbContext _db;
    private readonly ILogger<ChatHub> _logger;

    private static readonly ConcurrentDictionary<string, UserConnection> _connections = new();

    public ChatHub(
        IMessageService messageService,
        ApplicationDbContext db,
        ILogger<ChatHub> logger)
    {
        _messageService = messageService;
        _db = db;
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = GetCurrentUserId();
        var userName = GetCurrentUserName(userId);

        _connections[Context.ConnectionId] = new UserConnection
        {
            ConnectionId = Context.ConnectionId,
            UserId = userId,
            UserName = userName,
            ConnectedAt = DateTime.UtcNow
        };

        _logger.LogInformation("User connected: {UserName} ({ConnectionId})", userName, Context.ConnectionId);

        await Clients.Others.SendAsync("UserJoined", new { userName, userId });

        var onlineUsers = _connections.Values
            .GroupBy(u => u.UserId)
            .Select(g => g.First())
            .Select(u => new { u.UserName, u.UserId });

        await Clients.Caller.SendAsync("OnlineUsersUpdated", onlineUsers);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_connections.TryRemove(Context.ConnectionId, out var user))
        {
            _logger.LogInformation("User disconnected: {UserName}", user.UserName);
            await Clients.All.SendAsync("UserLeft", new { user.UserName, user.UserId });
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task SendMessage(string content)
    {
        if (string.IsNullOrWhiteSpace(content) || content.Length > 2000)
        {
            return;
        }

        var senderId = GetCurrentUserId();
        var senderName = GetCurrentUserName(senderId);
        var sanitized = Sanitize(content);

        var message = new MessageDto
        {
            Id = Guid.NewGuid().ToString(),
            Sender = senderName,
            SenderId = senderId,
            Content = sanitized,
            Timestamp = DateTime.UtcNow,
            IsEdited = false,
            IsPrivate = false
        };

        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = senderId,
            SenderName = senderName,
            Content = message.Content,
            Timestamp = message.Timestamp
        };

        try
        {
            await _messageService.SaveMessageAsync(chatMessage);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save public message to database");
        }

        await Clients.All.SendAsync("NewMessage", message);
    }

    public async Task SendPrivateMessage(string targetUserId, string content)
    {
        if (string.IsNullOrWhiteSpace(targetUserId) || string.IsNullOrWhiteSpace(content) || content.Length > 2000)
        {
            return;
        }

        var senderId = GetCurrentUserId();
        var senderName = GetCurrentUserName(senderId);
        var sanitized = Sanitize(content);

        var message = new MessageDto
        {
            Id = Guid.NewGuid().ToString(),
            Sender = senderName,
            SenderId = senderId,
            TargetUserId = targetUserId,
            Content = sanitized,
            Timestamp = DateTime.UtcNow,
            IsPrivate = true
        };

        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = senderId,
            SenderName = senderName,
            TargetUserId = targetUserId,
            Content = sanitized,
            Timestamp = message.Timestamp,
            IsPrivate = true
        };

        try
        {
            await _messageService.SaveMessageAsync(chatMessage);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save private message to database");
        }

        await Clients.Users(new[] { senderId, targetUserId }).SendAsync("NewMessage", message);
    }

    public async Task SendRoomMessage(string roomId, string content)
    {
        if (string.IsNullOrWhiteSpace(roomId) || string.IsNullOrWhiteSpace(content) || content.Length > 2000)
        {
            return;
        }

        var room = await _db.Rooms.AsNoTracking().FirstOrDefaultAsync(r => r.Id == roomId);
        if (room == null)
        {
            throw new HubException("Комната не найдена.");
        }

        var userId = GetCurrentUserId();
        var isMember = await _db.RoomMembers.AnyAsync(rm => rm.RoomId == roomId && rm.UserId == userId);
        if (!isMember)
        {
            throw new HubException("Вы не состоите в этой комнате.");
        }

        var senderName = GetCurrentUserName(userId);
        var sanitized = Sanitize(content);

        var message = new MessageDto
        {
            Id = Guid.NewGuid().ToString(),
            Sender = senderName,
            SenderId = userId,
            RoomId = roomId,
            RoomName = room.Name,
            Content = sanitized,
            Timestamp = DateTime.UtcNow,
            IsPrivate = false
        };

        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = userId,
            SenderName = senderName,
            RoomId = roomId,
            RoomName = room.Name,
            Content = sanitized,
            Timestamp = message.Timestamp
        };

        try
        {
            await _messageService.SaveMessageAsync(chatMessage);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save room message for room {RoomId}", roomId);
            throw;
        }

        await Clients.Group(roomId).SendAsync("RoomMessage", message);
    }

    public async Task SendTyping(string? targetUserId = null)
    {
        var sender = GetCurrentUserName();
        if (string.IsNullOrWhiteSpace(sender))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(targetUserId))
        {
            await Clients.Others.SendAsync("UserTyping", sender);
        }
        else
        {
            await Clients.User(targetUserId).SendAsync("UserTyping", sender);
        }
    }

    public async Task GetUserList()
    {
        var users = _connections.Values
            .GroupBy(u => u.UserId)
            .Select(g => g.First())
            .Select(u => new
            {
                u.UserId,
                u.UserName
            })
            .ToList();

        await Clients.Caller.SendAsync("UserList", users);
    }

    // Backward-compatible public group method used by older clients.
    public async Task JoinRoom(string roomName)
    {
        if (string.IsNullOrWhiteSpace(roomName))
        {
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        await GetPublicHistory();
    }

    public async Task<string> CreateRoom(string name, string? description)
    {
        var roomName = Sanitize(name);
        if (string.IsNullOrWhiteSpace(roomName) || roomName.Length > 80)
        {
            throw new HubException("Некорректное имя комнаты.");
        }

        var roomDescription = string.IsNullOrWhiteSpace(description) ? null : Sanitize(description);
        if (roomDescription?.Length > 300)
        {
            throw new HubException("Описание комнаты слишком длинное.");
        }

        var userId = GetCurrentUserId();
        var room = new ChatRoom
        {
            Id = Guid.NewGuid().ToString(),
            Name = roomName,
            Description = roomDescription,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow
        };

        _db.Rooms.Add(room);
        _db.RoomMembers.Add(new RoomMember
        {
            RoomId = room.Id,
            UserId = userId,
            IsAdmin = true,
            JoinedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();

        await Groups.AddToGroupAsync(Context.ConnectionId, room.Id);
        await GetUserRooms();

        return room.Id;
    }

    public async Task JoinChatRoom(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId))
        {
            return;
        }

        var room = await _db.Rooms.AsNoTracking().FirstOrDefaultAsync(r => r.Id == roomId);
        if (room == null)
        {
            throw new HubException("Комната не найдена.");
        }

        var userId = GetCurrentUserId();
        var existingMember = await _db.RoomMembers.FindAsync(roomId, userId);
        if (existingMember == null)
        {
            _db.RoomMembers.Add(new RoomMember
            {
                RoomId = roomId,
                UserId = userId,
                JoinedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync();
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

        try
        {
            var history = await _messageService.GetRoomMessagesAsync(roomId, 50);
            await Clients.Caller.SendAsync("MessageHistory", history.Select(ToDto).ToList());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load room history for room {RoomId}", roomId);
        }
    }

    public async Task LeaveRoom(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId))
        {
            return;
        }

        var userId = GetCurrentUserId();
        var member = await _db.RoomMembers.FindAsync(roomId, userId);
        if (member != null)
        {
            _db.RoomMembers.Remove(member);
            await _db.SaveChangesAsync();
        }

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await GetUserRooms();
    }

    public async Task GetUserRooms()
    {
        var userId = GetCurrentUserId();
        var rooms = await _db.RoomMembers
            .AsNoTracking()
            .Where(rm => rm.UserId == userId)
            .Include(rm => rm.Room)
            .OrderBy(rm => rm.Room.Name)
            .Select(rm => new
            {
                id = rm.Room.Id,
                name = rm.Room.Name,
                description = rm.Room.Description,
                isAdmin = rm.IsAdmin,
                createdBy = rm.Room.CreatedBy,
                createdAt = rm.Room.CreatedAt
            })
            .ToListAsync();

        await Clients.Caller.SendAsync("UserRooms", rooms);
    }

    public async Task GetMoreMessages(string lastMessageId)
    {
        try
        {
            var messages = await _messageService.GetMessagesBeforeAsync(lastMessageId, 30);
            await Clients.Caller.SendAsync("OlderMessages", messages.Select(ToDto).ToList());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load older messages");
        }
    }

    public async Task GetPublicHistory()
    {
        try
        {
            var messages = await _messageService.GetLastMessagesAsync(30);
            await Clients.Caller.SendAsync("MessageHistory", messages.Select(ToDto).ToList());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load public history");
        }
    }

    public async Task GetPrivateHistory(string otherUserId)
    {
        if (string.IsNullOrWhiteSpace(otherUserId))
        {
            return;
        }

        try
        {
            var currentUserId = GetCurrentUserId();
            var messages = await _messageService.GetPrivateMessagesAsync(currentUserId, otherUserId, 50);
            await Clients.Caller.SendAsync("MessageHistory", messages.Select(ToDto).ToList());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load private history with {OtherUserId}", otherUserId);
        }
    }

    public async Task EditMessage(string messageId, string newContent)
    {
        if (string.IsNullOrWhiteSpace(messageId) || string.IsNullOrWhiteSpace(newContent))
        {
            return;
        }

        var message = await _messageService.GetByIdAsync(messageId);
        if (message == null || message.IsDeleted)
        {
            return;
        }

        var userId = GetCurrentUserId();
        var userName = GetCurrentUserName(userId);
        if (!IsOwner(message, userId, userName))
        {
            return;
        }

        var sanitized = Sanitize(newContent);
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            return;
        }

        message.IsEdited = true;
        message.EditedAt = DateTime.UtcNow;
        await _messageService.UpdateMessageContentAsync(message, sanitized);

        await BroadcastMessageEditedAsync(message, sanitized);
    }

    public async Task DeleteMessage(string messageId)
    {
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return;
        }

        var message = await _messageService.GetByIdAsync(messageId);
        if (message == null || message.IsDeleted)
        {
            return;
        }

        var userId = GetCurrentUserId();
        var userName = GetCurrentUserName(userId);
        if (!IsOwner(message, userId, userName))
        {
            return;
        }

        message.IsDeleted = true;
        await _messageService.SoftDeleteMessageAsync(message);

        await BroadcastMessageDeletedAsync(message);
    }

    private async Task BroadcastMessageEditedAsync(ChatMessage message, string content)
    {
        var payload = new
        {
            messageId = message.Id,
            content,
            editedAt = message.EditedAt,
            roomId = message.RoomId,
            targetUserId = message.TargetUserId
        };

        if (!string.IsNullOrWhiteSpace(message.RoomId))
        {
            await Clients.Group(message.RoomId).SendAsync("MessageEdited", payload);
            return;
        }

        if (!string.IsNullOrWhiteSpace(message.TargetUserId))
        {
            var senderId = ExtractSenderId(message);
            if (!string.IsNullOrWhiteSpace(senderId))
            {
                await Clients.Users(new[] { senderId, message.TargetUserId }).SendAsync("MessageEdited", payload);
            }
            else
            {
                await Clients.Caller.SendAsync("MessageEdited", payload);
            }

            return;
        }

        await Clients.All.SendAsync("MessageEdited", payload);
    }

    private async Task BroadcastMessageDeletedAsync(ChatMessage message)
    {
        var payload = new
        {
            messageId = message.Id,
            roomId = message.RoomId,
            targetUserId = message.TargetUserId
        };

        if (!string.IsNullOrWhiteSpace(message.RoomId))
        {
            await Clients.Group(message.RoomId).SendAsync("MessageDeleted", payload);
            return;
        }

        if (!string.IsNullOrWhiteSpace(message.TargetUserId))
        {
            var senderId = ExtractSenderId(message);
            if (!string.IsNullOrWhiteSpace(senderId))
            {
                await Clients.Users(new[] { senderId, message.TargetUserId }).SendAsync("MessageDeleted", payload);
            }
            else
            {
                await Clients.Caller.SendAsync("MessageDeleted", payload);
            }

            return;
        }

        await Clients.All.SendAsync("MessageDeleted", payload);
    }

    private static bool IsOwner(ChatMessage message, string userId, string userName)
    {
        return string.Equals(message.Sender, userId, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(message.Sender, userName, StringComparison.OrdinalIgnoreCase) ||
               (!string.IsNullOrWhiteSpace(message.SenderName) &&
                string.Equals(message.SenderName, userName, StringComparison.OrdinalIgnoreCase));
    }

    private static string? ExtractSenderId(ChatMessage message)
    {
        if (!string.IsNullOrWhiteSpace(message.SenderName))
        {
            return message.Sender;
        }

        return null;
    }

    private static MessageDto ToDto(ChatMessage message)
    {
        var hasSenderName = !string.IsNullOrWhiteSpace(message.SenderName);

        return new MessageDto
        {
            Id = message.Id,
            Sender = hasSenderName ? message.SenderName : message.Sender,
            SenderId = hasSenderName ? message.Sender : null,
            TargetUserId = message.TargetUserId,
            RoomId = message.RoomId,
            RoomName = message.RoomName,
            Content = message.Content,
            Timestamp = message.Timestamp,
            IsEdited = message.IsEdited,
            EditedAt = message.EditedAt,
            IsPrivate = message.IsPrivate || message.TargetUserId != null
        };
    }

    private string GetCurrentUserId()
    {
        return Context.UserIdentifier ??
               Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ??
               Context.ConnectionId;
    }

    private string GetCurrentUserName(string? userId = null)
    {
        var userName = Context.User?.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(userName))
        {
            return userName;
        }

        var fromConnections = _connections.GetValueOrDefault(Context.ConnectionId)?.UserName;
        if (!string.IsNullOrWhiteSpace(fromConnections))
        {
            return fromConnections;
        }

        var fallbackId = userId ?? GetCurrentUserId();
        var suffix = fallbackId.Length > 5 ? fallbackId[..5] : fallbackId;
        return $"User_{suffix}";
    }

    private static string Sanitize(string input) =>
        System.Net.WebUtility.HtmlEncode(input)?.Trim() ?? string.Empty;
}
