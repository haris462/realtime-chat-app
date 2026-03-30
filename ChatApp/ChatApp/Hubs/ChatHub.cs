using System.Collections.Concurrent;
using System.Security.Claims;
using ChatApp.Data;
using ChatApp.DTOs;
using ChatApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly ChatDbContext _context;
    private static readonly ConcurrentDictionary<string, (int UserId, string Username, int? CurrentRoomId)> _connections = new();
    private static readonly ConcurrentDictionary<int, HashSet<string>> _roomConnections = new();
    private static readonly ConcurrentDictionary<string, DateTime> _typingUsers = new();
    private static readonly ConcurrentDictionary<int, string> _userIdToConnectionId = new();

    public ChatHub(ChatDbContext context)
    {
        _context = context;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = int.Parse(Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "0");
        var username = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Anonymous";

        _connections[Context.ConnectionId] = (userId, username, null);
        _userIdToConnectionId[userId] = Context.ConnectionId;

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_connections.TryRemove(Context.ConnectionId, out var userInfo))
        {
            _userIdToConnectionId.TryRemove(userInfo.UserId, out _);

            if (userInfo.CurrentRoomId.HasValue)
            {
                await LeaveRoom(userInfo.CurrentRoomId.Value);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(int roomId)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            // Leave current room if any
            if (userInfo.CurrentRoomId.HasValue)
            {
                await LeaveRoom(userInfo.CurrentRoomId.Value);
            }

            // Verify room exists and user has access
            var room = await _context.Rooms.FindAsync(roomId);
            if (room == null)
            {
                await Clients.Caller.SendAsync("Error", "Room not found");
                return;
            }

            // Check access for private rooms
            if (room.IsPrivate)
            {
                var hasAccess = room.CreatedBy == userInfo.UserId ||
                               await _context.RoomInvites.AnyAsync(ri => ri.RoomId == roomId && ri.UserId == userInfo.UserId);

                if (!hasAccess)
                {
                    await Clients.Caller.SendAsync("Error", "Access denied to private room");
                    return;
                }
            }

            // Add to room group
            await Groups.AddToGroupAsync(Context.ConnectionId, $"room_{roomId}");

            // Track connection in room
            _roomConnections.AddOrUpdate(
                roomId,
                new HashSet<string> { Context.ConnectionId },
                (key, set) => { set.Add(Context.ConnectionId); return set; }
            );

            // Update user's current room
            _connections[Context.ConnectionId] = (userInfo.UserId, userInfo.Username, roomId);

            // Add to database
            var userRoom = new UserRoom
            {
                UserId = userInfo.UserId,
                RoomId = roomId,
                JoinedAt = DateTime.UtcNow
            };

            if (!await _context.UserRooms.AnyAsync(ur => ur.UserId == userInfo.UserId && ur.RoomId == roomId))
            {
                _context.UserRooms.Add(userRoom);
                await _context.SaveChangesAsync();
            }

            // Load chat history WITH ATTACHMENTS
            var messages = await _context.Messages
                .Where(m => m.RoomId == roomId)
                .OrderByDescending(m => m.CreatedAt)
                .Take(50)
                .Include(m => m.User)
                .Include(m => m.Attachments)
                .Select(m => new MessageDto
                {
                    Id = m.Id,
                    RoomId = m.RoomId,
                    Username = m.User.Username,
                    Content = m.Content,
                    CreatedAt = m.CreatedAt,
                    Attachments = m.Attachments.Select(a => new AttachmentDto
                    {
                        Id = a.Id,
                        FileName = a.FileName,
                        FileType = a.FileType,
                        FileSize = a.FileSize,
                        FileUrl = a.FilePath
                    }).ToList()
                })
                .ToListAsync();

            messages.Reverse();

            await Clients.Caller.SendAsync("LoadHistory", messages);

            // Notify others in room
            await Clients.OthersInGroup($"room_{roomId}").SendAsync("UserJoined", userInfo.Username);

            // Send updated user list
            await SendUserList(roomId);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to join room: {ex.Message}");
        }
    }

    public async Task LeaveRoom(int roomId)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            // Remove from room group
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"room_{roomId}");

            // Remove from tracking
            if (_roomConnections.TryGetValue(roomId, out var connections))
            {
                connections.Remove(Context.ConnectionId);
                if (connections.Count == 0)
                {
                    _roomConnections.TryRemove(roomId, out _);
                }
            }

            // Update user's current room
            _connections[Context.ConnectionId] = (userInfo.UserId, userInfo.Username, null);

            // Remove from database
            var userRoom = await _context.UserRooms
                .FirstOrDefaultAsync(ur => ur.UserId == userInfo.UserId && ur.RoomId == roomId);

            if (userRoom != null)
            {
                _context.UserRooms.Remove(userRoom);
                await _context.SaveChangesAsync();
            }

            // Notify others
            await Clients.OthersInGroup($"room_{roomId}").SendAsync("UserLeft", userInfo.Username);

            // Send updated user list
            await SendUserList(roomId);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to leave room: {ex.Message}");
        }
    }

    public async Task SendMessage(int roomId, string content)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(content))
            {
                return;
            }

            // Save message to database
            var message = new Message
            {
                RoomId = roomId,
                UserId = userInfo.UserId,
                Content = content.Trim(),
                CreatedAt = DateTime.UtcNow
            };

            _context.Messages.Add(message);
            await _context.SaveChangesAsync();

            // Load attachments if any
            var attachments = await _context.Attachments
                .Where(a => a.MessageId == message.Id)
                .Select(a => new AttachmentDto
                {
                    Id = a.Id,
                    FileName = a.FileName,
                    FileType = a.FileType,
                    FileSize = a.FileSize,
                    FileUrl = a.FilePath
                })
                .ToListAsync();

            // Prepare DTO
            var messageDto = new MessageDto
            {
                Id = message.Id,
                RoomId = roomId,
                Username = userInfo.Username,
                Content = message.Content,
                CreatedAt = message.CreatedAt,
                Attachments = attachments
            };

            // Broadcast to room
            await Clients.Group($"room_{roomId}").SendAsync("ReceiveMessage", messageDto);

            // Clear typing indicator
            _typingUsers.TryRemove($"{roomId}_{userInfo.Username}", out _);
            await Clients.OthersInGroup($"room_{roomId}").SendAsync("UserStoppedTyping", userInfo.Username);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to send message: {ex.Message}");
        }
    }

    public async Task SendDirectMessage(int receiverId, string content)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(content))
            {
                return;
            }

            // Save to database
            var dm = new DirectMessage
            {
                SenderId = userInfo.UserId,
                ReceiverId = receiverId,
                Content = content.Trim(),
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            };

            _context.DirectMessages.Add(dm);
            await _context.SaveChangesAsync();

            var messageDto = new DirectMessageDto
            {
                Id = dm.Id,
                SenderId = userInfo.UserId,
                ReceiverId = receiverId,
                SenderUsername = userInfo.Username,
                Content = dm.Content,
                IsRead = dm.IsRead,
                CreatedAt = dm.CreatedAt
            };

            // Send to receiver if online
            if (_userIdToConnectionId.TryGetValue(receiverId, out var receiverConnectionId))
            {
                await Clients.Client(receiverConnectionId).SendAsync("ReceiveDirectMessage", messageDto);
            }

            // Send confirmation to sender
            await Clients.Caller.SendAsync("ReceiveDirectMessage", messageDto);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to send direct message: {ex.Message}");
        }
    }

    public async Task InitiateCall(int targetUserId, string callType)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            if (_userIdToConnectionId.TryGetValue(targetUserId, out var targetConnectionId))
            {
                await Clients.Client(targetConnectionId).SendAsync("IncomingCall", new
                {
                    CallerId = userInfo.UserId,
                    CallerName = userInfo.Username,
                    CallType = callType
                });
            }
            else
            {
                await Clients.Caller.SendAsync("Error", "User is offline");
            }
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to initiate call: {ex.Message}");
        }
    }

    public async Task AnswerCall(int callerId)
    {
        if (_userIdToConnectionId.TryGetValue(callerId, out var callerConnectionId))
        {
            if (_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                await Clients.Client(callerConnectionId).SendAsync("CallAnswered", new
                {
                    AnswererId = userInfo.UserId,
                    AnswererName = userInfo.Username
                });
            }
        }
    }

    public async Task RejectCall(int callerId)
    {
        if (_userIdToConnectionId.TryGetValue(callerId, out var callerConnectionId))
        {
            await Clients.Client(callerConnectionId).SendAsync("CallRejected");
        }
    }

    public async Task SendWebRTCSignal(int targetUserId, object signal)
    {
        if (_userIdToConnectionId.TryGetValue(targetUserId, out var targetConnectionId))
        {
            await Clients.Client(targetConnectionId).SendAsync("WebRTCSignal", signal);
        }
    }

    public async Task Typing(int roomId)
    {
        try
        {
            if (!_connections.TryGetValue(Context.ConnectionId, out var userInfo))
            {
                return;
            }

            var key = $"{roomId}_{userInfo.Username}";
            _typingUsers[key] = DateTime.UtcNow;

            await Clients.OthersInGroup($"room_{roomId}").SendAsync("UserTyping", userInfo.Username);

            _ = Task.Run(async () =>
            {
                await Task.Delay(3000);
                if (_typingUsers.TryGetValue(key, out var lastTyping))
                {
                    if ((DateTime.UtcNow - lastTyping).TotalSeconds >= 3)
                    {
                        _typingUsers.TryRemove(key, out _);
                        await Clients.OthersInGroup($"room_{roomId}").SendAsync("UserStoppedTyping", userInfo.Username);
                    }
                }
            });
        }
        catch
        {
            // Silently fail
        }
    }

    public async Task NotifyAttachmentAdded(int messageId, int roomId)
    {
        try
        {
            var message = await _context.Messages
                .Include(m => m.User)
                .Include(m => m.Attachments)
                .FirstOrDefaultAsync(m => m.Id == messageId);

            if (message == null) return;

            var messageDto = new MessageDto
            {
                Id = message.Id,
                RoomId = message.RoomId,
                Username = message.User.Username,
                Content = message.Content,
                CreatedAt = message.CreatedAt,
                Attachments = message.Attachments.Select(a => new AttachmentDto
                {
                    Id = a.Id,
                    FileName = a.FileName,
                    FileType = a.FileType,
                    FileSize = a.FileSize,
                    FileUrl = a.FilePath
                }).ToList()
            };

            await Clients.Group($"room_{roomId}").SendAsync("MessageUpdated", messageDto);
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("Error", $"Failed to notify attachment: {ex.Message}");
        }
    }

    private async Task SendUserList(int roomId)
    {
        if (_roomConnections.TryGetValue(roomId, out var connections))
        {
            var users = connections
                .Select(connId => _connections.TryGetValue(connId, out var info) ? info.Username : null)
                .Where(username => username != null)
                .Distinct()
                .ToList();

            await Clients.Group($"room_{roomId}").SendAsync("UpdateUserList", users);
        }
    }
} 