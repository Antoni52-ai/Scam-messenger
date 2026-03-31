using Messenger.Data;
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace Messenger.Services;

public class MessageService : IMessageService
{
    private readonly ApplicationDbContext _db;
    private readonly IEncryptionService _encryption;

    public MessageService(ApplicationDbContext db, IEncryptionService encryption)
    {
        _db = db;
        _encryption = encryption;
    }

    public async Task<List<ChatMessage>> GetLastMessagesAsync(int count)
    {
        var messages = await _db.Messages
            .Where(m => !m.IsDeleted &&
                        !m.IsPrivate &&
                        m.TargetUserId == null &&
                        m.RoomId == null)
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .OrderBy(m => m.Timestamp)
            .ToListAsync();

        DecryptAll(messages);
        return messages;
    }

    public async Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count)
    {
        if (string.IsNullOrEmpty(lastMessageId))
        {
            return await GetLastMessagesAsync(count);
        }

        var pivot = await _db.Messages.FindAsync(lastMessageId);
        if (pivot == null)
        {
            return await GetLastMessagesAsync(count);
        }

        var messages = await _db.Messages
            .Where(m => !m.IsDeleted &&
                        !m.IsPrivate &&
                        m.TargetUserId == null &&
                        m.RoomId == null &&
                        m.Timestamp < pivot.Timestamp)
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .OrderBy(m => m.Timestamp)
            .ToListAsync();

        DecryptAll(messages);
        return messages;
    }

    public async Task<List<ChatMessage>> GetPrivateMessagesAsync(string userId, string otherUserId, int count = 30)
    {
        var messages = await _db.Messages
            .Where(m => !m.IsDeleted &&
                        m.TargetUserId != null &&
                        ((m.Sender == userId && m.TargetUserId == otherUserId) ||
                         (m.Sender == otherUserId && m.TargetUserId == userId)))
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .OrderBy(m => m.Timestamp)
            .ToListAsync();

        DecryptAll(messages);
        return messages;
    }

    public async Task<List<ChatMessage>> GetRoomMessagesAsync(string roomId, int count = 30)
    {
        var messages = await _db.Messages
            .Where(m => !m.IsDeleted && m.RoomId == roomId)
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .OrderBy(m => m.Timestamp)
            .ToListAsync();

        DecryptAll(messages);
        return messages;
    }

    public Task<ChatMessage?> GetByIdAsync(string messageId)
    {
        return _db.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
    }

    public async Task UpdateMessageContentAsync(ChatMessage message, string newContent)
    {
        message.Content = _encryption.Encrypt(newContent);
        _db.Messages.Update(message);
        await _db.SaveChangesAsync();
    }

    public async Task SoftDeleteMessageAsync(ChatMessage message)
    {
        _db.Messages.Update(message);
        await _db.SaveChangesAsync();
    }

    public async Task SaveMessageAsync(ChatMessage message)
    {
        message.Content = _encryption.Encrypt(message.Content);
        _db.Messages.Add(message);
        await _db.SaveChangesAsync();
    }

    private void DecryptAll(List<ChatMessage> messages)
    {
        foreach (var m in messages)
        {
            m.Content = _encryption.Decrypt(m.Content);
        }
    }
}
