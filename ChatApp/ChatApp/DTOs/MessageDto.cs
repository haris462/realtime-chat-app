namespace ChatApp.DTOs;

public class MessageDto
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public List<AttachmentDto> Attachments { get; set; } = new List<AttachmentDto>();
}