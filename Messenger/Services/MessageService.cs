using Messenger.Data;
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace Messenger.Services
{
    public class MessageService : IMessageService
    {
        private readonly ApplicationDbContext _db;

        public MessageService(ApplicationDbContext db) => _db = db;

        public async Task<List<ChatMessage>> GetLastMessagesAsync(int count)
        {
            return await _db.Messages
                .OrderByDescending(m => m.Timestamp)
                .Take(count)
                .OrderBy(m => m.Timestamp)
                .ToListAsync();
        }

        public async Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count)
        {
            if (string.IsNullOrEmpty(lastMessageId))
                return await GetLastMessagesAsync(count);

            var pivot = await _db.Messages.FindAsync(lastMessageId);
            if (pivot == null)
                return await GetLastMessagesAsync(count);

            return await _db.Messages
                .Where(m => m.Timestamp < pivot.Timestamp)
                .OrderByDescending(m => m.Timestamp)
                .Take(count)
                .OrderBy(m => m.Timestamp)
                .ToListAsync();
        }

        public async Task<List<ChatMessage>> GetPrivateMessagesAsync(
            string userId, string otherUserId, int count = 30)
        {
            return await _db.Messages
                .Where(m => m.TargetUserId != null &&
                    ((m.Sender == userId && m.TargetUserId == otherUserId) ||
                     (m.Sender == otherUserId && m.TargetUserId == userId)))
                .OrderByDescending(m => m.Timestamp)
                .Take(count)
                .OrderBy(m => m.Timestamp)
                .ToListAsync();
        }

        public async Task SaveMessageAsync(ChatMessage message)
        {
            _db.Messages.Add(message);
            await _db.SaveChangesAsync();
        }
    }
}
