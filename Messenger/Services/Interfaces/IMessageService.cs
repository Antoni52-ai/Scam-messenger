using Messenger.Models.Entity;

namespace Messenger.Services.Interfaces
{
    public interface IMessageService
    {
        Task<List<ChatMessage>> GetLastMessagesAsync(int count);
        Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count);
        Task<List<ChatMessage>> GetPrivateMessagesAsync(string userId, string otherUserId, int count = 30);
        Task SaveMessageAsync(ChatMessage message);
    }
}
