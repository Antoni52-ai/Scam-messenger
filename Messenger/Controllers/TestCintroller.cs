using Microsoft.AspNetCore.Mvc;

namespace Messenger.Controllers;

public class TestController : Controller
{
    public IActionResult Index()
    {
        return Content("Hello! Chat is working!");
    }
}