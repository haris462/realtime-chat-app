using System.Security.Claims;
using ChatApp.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly ChatDbContext _context;

    public UsersController(ChatDbContext context)
    {
        _context = context;
    }

    [HttpGet("search")]
    public async Task<IActionResult> SearchUsers([FromQuery] string query)
    {
        var currentUserId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        if (string.IsNullOrWhiteSpace(query))
        {
            return Ok(new List<object>());
        }

        var users = await _context.Users
            .Where(u => u.Id != currentUserId && u.Username.Contains(query))
            .Select(u => new
            {
                u.Id,
                u.Username
            })
            .Take(10)
            .ToListAsync();

        return Ok(users);
    }
}