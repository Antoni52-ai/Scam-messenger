using System.ComponentModel.DataAnnotations;

namespace Messenger.Models.Entity;

public class ChatRoom
{
    [Key]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string CreatedBy { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool IsPrivate { get; set; } = false;

    // Навигационные свойства
    public ICollection<RoomMember> Members { get; set; } = new List<RoomMember>();
    public ICollection<ChatMessage> Messages { get; set; } = new List<ChatMessage>();
}

public class RoomMember
{
    public string RoomId { get; set; }
    public ChatRoom Room { get; set; } = null!;

    public string UserId { get; set; }
    public ApplicationUser User { get; set; } = null!;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public bool IsAdmin { get; set; } = false;
}