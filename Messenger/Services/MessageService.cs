using Messenger.Data;
using Messenger.Models.Entity;
using Messenger.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace Messenger.Services;

public class MessageService : IMessageService
{
    private readonly ApplicationDbContext _context;
    private readonly IEncryptionService _encryption;

    public MessageService(
        ApplicationDbContext context,
        IEncryptionService encryption)
    {
        _context = context;
        _encryption = encryption;
    }

    public async Task<List<ChatMessage>> GetLastMessagesAsync(int count)
    {
        var messages = await _context.Messages
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .ToListAsync();

        // 🔐 Расшифровываем при чтении
        foreach (var msg in messages)
        {
            msg.Content = _encryption.Decrypt(msg.Content);
        }

        return messages;
    }

    public async Task<List<ChatMessage>> GetMessagesBeforeAsync(string? lastMessageId, int count)
    {
        var query = _context.Messages.AsQueryable();

        if (!string.IsNullOrEmpty(lastMessageId))
        {
            var lastMessage = await _context.Messages
                .FirstOrDefaultAsync(m => m.Id == lastMessageId);

            if (lastMessage != null)
            {
                query = query.Where(m => m.Timestamp < lastMessage.Timestamp);
            }
        }

        var messages = await query
            .OrderByDescending(m => m.Timestamp)
            .Take(count)
            .ToListAsync();

        // 🔐 Расшифровываем при чтении
        foreach (var msg in messages)
        {
            msg.Content = _encryption.Decrypt(msg.Content);
        }

        return messages;
    }

    public async Task SaveMessageAsync(ChatMessage message)
    {
        // 🔐 Шифруем перед сохранением!
        message.Content = _encryption.Encrypt(message.Content);

        _context.Messages.Add(message);
        await _context.SaveChangesAsync();
    }
}