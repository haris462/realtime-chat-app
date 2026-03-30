using System.ComponentModel.DataAnnotations.Schema;

namespace ChatApp.Models;

[Table("user_rooms")]
public class UserRoom
{
    [Column("user_id")]
    public int UserId { get; set; }

    [Column("room_id")]
    public int RoomId { get; set; }

    [Column("joined_at")]
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    [ForeignKey("UserId")]
    public User User { get; set; } = null!;

    [ForeignKey("RoomId")]
    public Room Room { get; set; } = null!;
}