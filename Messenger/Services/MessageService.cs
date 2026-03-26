// БЫЛО:
// СТАЛО:
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Messenger.Models.Entity;

namespace Messenger.Services
{
    public class MessageService : IMessageService
    {
        private static readonly List<ChatMessage> _messages = new();

        public Task<List<ChatMessage>> GetLastMessagesAsync(int count)
        {
            var result = _messages
                .OrderByDescending(m => m.Timestamp)
                .Take(count)
                .Reverse()
                .ToList();
            return Task.FromResult(result);
        }

        public Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count)
        {
            var query = _messages.AsQueryable();

            if (!string.IsNullOrEmpty(lastMessageId))
            {
                var foundMessage = _messages.FirstOrDefault(x => x.Id == lastMessageId);
                if (foundMessage != null)
                {
                    query = query.Where(m => m.Timestamp < foundMessage.Timestamp);
                }
            }

            var result = query
                .OrderByDescending(m => m.Timestamp)
                .Take(count)
                .ToList();

            return Task.FromResult(result);
        }

        public Task SaveMessageAsync(ChatMessage message)
        {
            _messages.Add(message);
            return Task.CompletedTask;
        }
    }
}