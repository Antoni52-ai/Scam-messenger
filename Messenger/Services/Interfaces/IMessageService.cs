using Messenger.Models.Entity;

namespace Messenger.Services.Interfaces
{
    public interface IMessageService
    {
        Task<List<ChatMessage>> GetLastMessagesAsync(int count);
        Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count);
        Task<List<ChatMessage>> GetPrivateMessagesAsync(string userId, string otherUserId, int count = 30);
        Task<List<ChatMessage>> GetRoomMessagesAsync(string roomId, int count = 30);
        Task<ChatMessage?> GetByIdAsync(string messageId);
        Task UpdateMessageContentAsync(ChatMessage message, string newContent);
        Task SoftDeleteMessageAsync(ChatMessage message);
        Task SaveMessageAsync(ChatMessage message);
    }
}
