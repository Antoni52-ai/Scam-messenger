using Messenger.Models.Entity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using System.Reflection.Emit;

namespace Messenger.Data;  // ✅ Проверь namespace

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    public DbSet<ChatMessage> Messages { get; set; }
    public DbSet<ChatRoom> Rooms { get; set; }

    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Индексы для производительности
        builder.Entity<ChatMessage>()
            .HasIndex(m => new { m.Sender, m.Timestamp })
            .HasDatabaseName("IX_Messages_Sender_Timestamp");

        builder.Entity<ChatMessage>()
            .HasIndex(m => m.TargetUserId)
            .HasDatabaseName("IX_Messages_TargetUser");
    }
}