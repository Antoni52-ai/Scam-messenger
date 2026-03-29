namespace Messenger.Models.DTO
{
    public class MessageDto
    {
        public string Id { get; set; } = string.Empty;
        public string Sender { get; set; } = string.Empty;
        public string? SenderId { get; set; }
        public string? TargetUserId { get; set; }
        public string? RoomId { get; set; }
        public string Content { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; }
        public bool IsEdited { get; set; }
        public DateTime? EditedAt { get; set; }
        public bool IsPrivate { get; set; }
        public string? RoomName { get; set; }
    }
}
