using Microsoft.AspNetCore.Mvc;

namespace Messenger.Controllers;

public class HomeController : Controller
{
    public IActionResult Index()
    {
        return RedirectToAction("Index", "Chat");
    }
}