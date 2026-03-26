using Messenger.Models.Entity;
using Messenger.Models.Entity;

namespace Messenger.Services.Interfaces
{
    public interface IMessageService
    {
        Task<List<ChatMessage>> GetLastMessagesAsync(int count);
        Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count);
        Task SaveMessageAsync(ChatMessage message);
    }
}