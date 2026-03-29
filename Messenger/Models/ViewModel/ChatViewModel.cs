using Messenger.Models.Entity;

namespace Messenger.Models.ViewModel
{
    public class ChatViewModel
    {
        public string? CurrentUser { get; set; }
        public string? CurrentUserId { get; set; }
        public List<ChatMessage> RecentMessages { get; set; } = new();
        public int OnlineCount { get; set; }
    }
}
