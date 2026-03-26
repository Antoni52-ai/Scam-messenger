using Messenger.Models.DTO;
using Messenger.Models.Entity;
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Reflection.Metadata;
using System.Xml.Linq;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace Messenger.Hubs;  // ✅ Исправлено с MessengerApp

[Authorize]
public class ChatHub : Hub
{
    private readonly IMessageService _messageService;
    private readonly ILogger<ChatHub> _logger;

    private static readonly ConcurrentDictionary<string, UserConnection> _connections = new();

    public ChatHub(
        IMessageService messageService,
        ILogger<ChatHub> logger)
    {
        _messageService = messageService;
        _logger = logger;
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

        // Сохраняем как ChatMessage
        var chatMessage = new ChatMessage
        {
            Id = message.Id,
            Sender = message.Sender,
            Content = message.Content,
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
            Content = message.Content,
            Timestamp = message.Timestamp
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

    public async Task JoinRoom(string roomName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        var sender = _connections.GetValueOrDefault(Context.ConnectionId)?.UserName;
        await Clients.Group(roomName).SendAsync("SystemMessage",
            new { text = $"{sender} присоединился к комнате", timestamp = DateTime.UtcNow });
    }

    private string Sanitize(string input) =>
        System.Net.WebUtility.HtmlEncode(input)?.Trim() ?? string.Empty;

}