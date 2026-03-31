namespace Messenger.Models.Entity
{
    public class ChatMessage
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Sender { get; set; } = string.Empty;
        public string SenderName { get; set; } = string.Empty;
        public string? TargetUserId { get; set; }
        public string? RoomName { get; set; }
        public string? RoomId { get; set; }
        public ChatRoom? Room { get; set; }
        public bool IsPrivate { get; set; }
        public string Content { get; set; } = string.Empty;
        public string? FileUrl { get; set; }
        public string? FileName { get; set; }
        public long? FileSize { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public bool IsEdited { get; set; }
        public DateTime? EditedAt { get; set; }
        public bool IsDeleted { get; set; }
    }
}
