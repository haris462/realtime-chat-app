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
public class RoomsController : ControllerBase
{
    private readonly ChatDbContext _context;

    public RoomsController(ChatDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> GetRooms()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        // Get public rooms and private rooms user has access to
        var rooms = await _context.Rooms
            .Where(r => !r.IsPrivate ||
                       r.CreatedBy == userId ||
                       _context.RoomInvites.Any(ri => ri.RoomId == r.Id && ri.UserId == userId))
            .Select(r => new RoomDto
            {
                Id = r.Id,
                Name = r.Name,
                Description = r.Description,
                IsPrivate = r.IsPrivate,
                CreatedBy = r.CreatedBy
            })
            .ToListAsync();

        return Ok(rooms);
    }

    [HttpPost]
    public async Task<IActionResult> CreateRoom([FromBody] CreateRoomDto dto)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        // Check if room name already exists
        if (await _context.Rooms.AnyAsync(r => r.Name == dto.Name))
        {
            return BadRequest(new { message = "Room name already exists" });
        }

        var room = new Room
        {
            Name = dto.Name,
            Description = dto.Description,
            IsPrivate = dto.IsPrivate,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow
        };

        _context.Rooms.Add(room);
        await _context.SaveChangesAsync();

        // Auto-join creator to room
        var userRoom = new UserRoom
        {
            UserId = userId,
            RoomId = room.Id,
            JoinedAt = DateTime.UtcNow
        };

        _context.UserRooms.Add(userRoom);
        await _context.SaveChangesAsync();

        return Ok(new RoomDto
        {
            Id = room.Id,
            Name = room.Name,
            Description = room.Description,
            IsPrivate = room.IsPrivate,
            CreatedBy = room.CreatedBy
        });
    }

    [HttpPost("{roomId}/invite")]
    public async Task<IActionResult> InviteUser(int roomId, [FromBody] string username)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");

        var room = await _context.Rooms.FindAsync(roomId);
        if (room == null)
        {
            return NotFound(new { message = "Room not found" });
        }

        // Only room creator can invite
        if (room.CreatedBy != userId)
        {
            return Forbid();
        }

        var invitedUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (invitedUser == null)
        {
            return NotFound(new { message = "User not found" });
        }

        // Check if already invited
        if (await _context.RoomInvites.AnyAsync(ri => ri.RoomId == roomId && ri.UserId == invitedUser.Id))
        {
            return BadRequest(new { message = "User already invited" });
        }

        var invite = new RoomInvite
        {
            RoomId = roomId,
            UserId = invitedUser.Id,
            InvitedBy = userId,
            CreatedAt = DateTime.UtcNow
        };

        _context.RoomInvites.Add(invite);
        await _context.SaveChangesAsync();

        return Ok(new { message = "User invited successfully" });
    }
}