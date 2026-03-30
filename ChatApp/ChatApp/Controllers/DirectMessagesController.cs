using System.Security.Claims;
using ChatApp.Data;
using ChatApp.DTOs;
using ChatApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class DirectMessagesController : ControllerBase
{
    private readonly ChatDbContext _context;

    public DirectMessagesController(ChatDbContext context)
    {
        _context = context;
    }

    [HttpGet("conversations")]
    public async Task<IActionResult> GetConversations()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        var conversations = await _context.DirectMessages
            .Where(dm => dm.SenderId == userId || dm.ReceiverId == userId)
            .Include(dm => dm.Sender)
            .Include(dm => dm.Receiver)
            .GroupBy(dm => dm.SenderId == userId ? dm.ReceiverId : dm.SenderId)
            .Select(g => new
            {
                UserId = g.Key,
                Username = g.First().SenderId == userId ? g.First().Receiver.Username : g.First().Sender.Username,
                LastMessage = g.OrderByDescending(dm => dm.CreatedAt).First().Content,
                LastMessageTime = g.OrderByDescending(dm => dm.CreatedAt).First().CreatedAt,
                UnreadCount = g.Count(dm => dm.ReceiverId == userId && !dm.IsRead)
            })
            .OrderByDescending(c => c.LastMessageTime)
            .ToListAsync();

        return Ok(conversations);
    }

    [HttpGet("{otherUserId}")]
    public async Task<IActionResult> GetMessages(int otherUserId)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        var messages = await _context.DirectMessages
            .Where(dm =>
                (dm.SenderId == userId && dm.ReceiverId == otherUserId) ||
                (dm.SenderId == otherUserId && dm.ReceiverId == userId))
            .Include(dm => dm.Sender)
            .OrderBy(dm => dm.CreatedAt)
            .Select(dm => new DirectMessageDto
            {
                Id = dm.Id,
                SenderId = dm.SenderId,
                ReceiverId = dm.ReceiverId,
                SenderUsername = dm.Sender.Username,
                Content = dm.Content,
                IsRead = dm.IsRead,
                CreatedAt = dm.CreatedAt
            })
            .ToListAsync();

        // Mark messages as read
        var unreadMessages = await _context.DirectMessages
            .Where(dm => dm.SenderId == otherUserId && dm.ReceiverId == userId && !dm.IsRead)
            .ToListAsync();

        foreach (var msg in unreadMessages)
        {
            msg.IsRead = true;
        }

        await _context.SaveChangesAsync();

        return Ok(messages);
    }

    [HttpPost("send")]
    public async Task<IActionResult> SendMessage([FromBody] SendDirectMessageDto dto)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        var dm = new DirectMessage
        {
            SenderId = userId,
            ReceiverId = dto.ReceiverId,
            Content = dto.Content,
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        };

        _context.DirectMessages.Add(dm);
        await _context.SaveChangesAsync();

        var sender = await _context.Users.FindAsync(userId);

        return Ok(new DirectMessageDto
        {
            Id = dm.Id,
            SenderId = dm.SenderId,
            ReceiverId = dm.ReceiverId,
            SenderUsername = sender?.Username ?? "",
            Content = dm.Content,
            IsRead = dm.IsRead,
            CreatedAt = dm.CreatedAt
        });
    }
}