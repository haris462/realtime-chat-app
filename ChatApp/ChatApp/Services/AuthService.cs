using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ChatApp.Data;
using ChatApp.DTOs;
using ChatApp.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace ChatApp.Services;

public class AuthService : IAuthService
{
    private readonly ChatDbContext _context;
    private readonly IConfiguration _configuration;

    public AuthService(ChatDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    public async Task<(bool Success, string Token, string Username, string Message)> RegisterAsync(RegisterDto registerDto)
    {
        // Check if username exists
        if (await _context.Users.AnyAsync(u => u.Username == registerDto.Username))
        {
            return (false, string.Empty, string.Empty, "Username already exists");
        }

        // Check if email exists
        if (await _context.Users.AnyAsync(u => u.Email == registerDto.Email))
        {
            return (false, string.Empty, string.Empty, "Email already exists");
        }

        // Hash password
        string passwordHash = BCrypt.Net.BCrypt.HashPassword(registerDto.Password);

        // Create user
        var user = new User
        {
            Username = registerDto.Username,
            Email = registerDto.Email,
            PasswordHash = passwordHash,
            CreatedAt = DateTime.UtcNow
        };

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        // Generate token
        string token = GenerateJwtToken(user.Id, user.Username);

        return (true, token, user.Username, "Registration successful");
    }

    public async Task<(bool Success, string Token, string Username, string Message)> LoginAsync(LoginDto loginDto)
    {
        // Find user
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == loginDto.Username);

        if (user == null)
        {
            return (false, string.Empty, string.Empty, "Invalid username or password");
        }

        // Verify password
        if (!BCrypt.Net.BCrypt.Verify(loginDto.Password, user.PasswordHash))
        {
            return (false, string.Empty, string.Empty, "Invalid username or password");
        }

        // Generate token
        string token = GenerateJwtToken(user.Id, user.Username);

        return (true, token, user.Username, "Login successful");
    }

    public string GenerateJwtToken(int userId, string username)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = jwtSettings["SecretKey"] ?? throw new InvalidOperationException("JWT SecretKey not configured");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Name, username),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"],
            audience: jwtSettings["Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(24),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}