using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ChatApp.Models;

[Table("direct_messages")]
public class DirectMessage
{
    [Key]
    [Column("id")]
    public int Id { get; set; }

    [Required]
    [Column("sender_id")]
    public int SenderId { get; set; }

    [Required]
    [Column("receiver_id")]
    public int ReceiverId { get; set; }

    [Required]
    [Column("content")]
    public string Content { get; set; } = string.Empty;

    [Column("is_read")]
    public bool IsRead { get; set; } = false;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    [ForeignKey("SenderId")]
    public User Sender { get; set; } = null!;

    [ForeignKey("ReceiverId")]
    public User Receiver { get; set; } = null!;
}