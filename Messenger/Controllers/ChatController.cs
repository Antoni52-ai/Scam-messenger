using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Messenger.Models.ViewModel;
using Messenger.Services.Interfaces;
using System.Security.Claims;

namespace Messenger.Controllers;

[Authorize] 
public class ChatController : Controller
{
    private readonly IMessageService _messageService;

    public ChatController(IMessageService messageService)
    {
        _messageService = messageService;
    }

    public async Task<IActionResult> Index()
    {
        var viewModel = new ChatViewModel
        {
            CurrentUser = User.Identity?.Name,
            CurrentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            RecentMessages = await _messageService.GetLastMessagesAsync(50),
            OnlineCount = 0
        };

        return View(viewModel);
    }
}
