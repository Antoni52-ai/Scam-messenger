using Messenger.Data;
using Messenger.Models.DTO;
using Messenger.Models.Entity;
using Messenger.Services;
using Messenger.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using System.Net;

namespace Messenger.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly IMessageService _messageService;
    private readonly ILogger<ChatHub> _logger;
    private readonly IEncryptionService _encryption;
    private readonly ApplicationDbContext _context;
    private static readonly ConcurrentDictionary<string, UserConnection> _connections = new();

    public ChatHub(
        IMessageService messageService,
        ILogger<ChatHub> logger,
        IEncryptionService encryption,
        ApplicationDbContext context)
    {
        _messageService = messageService;
        _logger = logger;
        _encryption = encryption;
        _context = context;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.UserIdentifier ?? Context.ConnectionId;
        var userName = Context.User?.Identity?.Name ?? $"User_{userId[..5]}";

        _connections[Context.ConnectionId] = new UserConnection
        {
            ConnectionId = Context.ConnectionId,
            UserId = userId,
            UserName = userName,
            ConnectedAt = DateTime.UtcNow
        };

        _logger.LogInformation("User connected: {UserName} ({ConnectionId})", userName, Context.ConnectionId);

        await Clients.Others.SendAsync("UserJoined", new { userName, userId });

        var onlineUsers = _connections.Values.Select(u => new { u.UserName, u.UserId });
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
            return;

        var sender = _connections.GetValueOrDefault(Context.ConnectionId)?.UserName ?? "Unknown";

        var message = new MessageDto
        {
            Id = Guid.NewGuid().ToString(),
            Sender = sender,
            Content = Sanitize(content),
            Timestamp = DateTime.UtcNow,
            IsEdited = false
        };

        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = message.Sender,
            Content = _encryption.Encrypt(message.Content), // 🔐 Шифруем
            Timestamp = message.Timestamp
        };

        _ = _messageService.SaveMessageAsync(chatMessage);
        await Clients.All.SendAsync("NewMessage", message);
    }


    public async Task SendPrivateMessage(string targetUserId, string content)
    {
        var sender = _connections.GetValueOrDefault(Context.ConnectionId);
        if (sender == null) return;

        var message = new MessageDto
        {
            Id = Guid.NewGuid().ToString(),
            Sender = sender.UserName,
            SenderId = sender.UserId,
            TargetUserId = targetUserId,
            Content = Sanitize(content),
            Timestamp = DateTime.UtcNow,
            IsPrivate = true
        };

        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = message.Sender,
            TargetUserId = message.TargetUserId,
            Content = _encryption.Encrypt(message.Content), // 🔐 Шифруем
            Timestamp = message.Timestamp,
            IsPrivate = true
        };

        await _messageService.SaveMessageAsync(chatMessage);

        await Clients.Users(new[] { sender.UserId, targetUserId })
                    .SendAsync("NewMessage", message);
    }

    public async Task SendTyping(string? targetUserId = null)
    {
        var sender = _connections.GetValueOrDefault(Context.ConnectionId)?.UserName;
        if (string.IsNullOrEmpty(sender)) return;

        if (string.IsNullOrEmpty(targetUserId))
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
        var users = _connections.Values.Select(u => new
        {
            u.UserId,
            u.UserName
        }).ToList();

        await Clients.Caller.SendAsync("UserList", users);
    }

   
    public async Task JoinChatRoom(string roomId)
    {
        var userId = Context.UserIdentifier;
        var userName = Context.User?.Identity?.Name;

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

        await Clients.Group(roomId).SendAsync("UserJoinedRoom", new
        {
            userId,
            userName,
            roomId
        });
    }

    // 🔥 НОВОЕ: Создать групповой чат
    public async Task CreateRoom(string roomName, string? description = null)
    {
        var userId = Context.UserIdentifier;
        if (string.IsNullOrEmpty(userId)) return;

        var room = new ChatRoom
        {
            Name = roomName,
            Description = description,
            CreatedBy = userId,
            IsPrivate = false
        };

        room.Members.Add(new RoomMember
        {
            UserId = userId,
            IsAdmin = true
        });

        _context.Rooms.Add(room);
        await _context.SaveChangesAsync();

        await Groups.AddToGroupAsync(Context.ConnectionId, room.Id);

        await Clients.Caller.SendAsync("RoomCreated", new
        {
            room.Id,
            room.Name,
            room.Description
        });
    }


    public async Task SendRoomMessage(string roomId, string content)
    {
        var sender = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(sender)) return;

        var message = new ChatMessage
        {
            Sender = sender,
            Content = _encryption.Encrypt(content), 
            RoomId = roomId,
            Timestamp = DateTime.UtcNow
        };

        _context.Messages.Add(message);
        await _context.SaveChangesAsync();

        await Clients.Group(roomId).SendAsync("NewRoomMessage", new
        {
            message.Id,
            message.Sender,
            Content = _encryption.Decrypt(message.Content), 
            message.Timestamp,
            RoomId = roomId
        });
    }


    public async Task GetUserRooms()
    {
        var userId = Context.UserIdentifier;

        var rooms = await _context.Rooms
            .Where(r => r.Members.Any(m => m.UserId == userId))
            .Select(r => new
            {
                r.Id,
                r.Name,
                r.Description,
                MemberCount = r.Members.Count()
            })
            .ToListAsync();

        await Clients.Caller.SendAsync("UserRooms", rooms);
    }

 
    private string Sanitize(string input) =>
        WebUtility.HtmlEncode(input)?.Trim() ?? string.Empty;
}