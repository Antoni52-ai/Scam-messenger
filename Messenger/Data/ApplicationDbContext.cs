using Messenger.Models.Entity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using System.Reflection.Emit;

namespace Messenger.Data;  // ✅ Проверь namespace

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    public DbSet<ChatMessage> Messages { get; set; }
    public DbSet<ChatRoom> Rooms { get; set; }
    public DbSet<RoomMember> RoomMembers { get; set; }

    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Конфигурация RoomMember (составной ключ)
        builder.Entity<RoomMember>()
            .HasKey(rm => new { rm.RoomId, rm.UserId });
    }
}