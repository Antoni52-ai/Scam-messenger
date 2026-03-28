using Microsoft.AspNetCore.Identity;

namespace Messenger.Models.Entity;

public class ApplicationUser : IdentityUser
{
    // Можешь добавить свои свойства
    public DateTime? LastActiveAt { get; set; }
    public bool IsOnline { get; set; }
}