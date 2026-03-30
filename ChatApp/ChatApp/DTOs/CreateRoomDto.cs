using System.ComponentModel.DataAnnotations;

namespace ChatApp.DTOs;

public class CreateRoomDto
{
    [Required]
    [MinLength(3)]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Description { get; set; }

    public bool IsPrivate { get; set; } = false;
}