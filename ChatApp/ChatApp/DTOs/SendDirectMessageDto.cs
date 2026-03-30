using System.ComponentModel.DataAnnotations;

namespace ChatApp.DTOs;

public class SendDirectMessageDto
{
    [Required]
    public int ReceiverId { get; set; }

    [Required]
    public string Content { get; set; } = string.Empty;
}