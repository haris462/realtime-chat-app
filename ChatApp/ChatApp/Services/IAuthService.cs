using ChatApp.DTOs;

namespace ChatApp.Services;

public interface IAuthService
{
    Task<(bool Success, string Token, string Username, string Message)> RegisterAsync(RegisterDto registerDto);
    Task<(bool Success, string Token, string Username, string Message)> LoginAsync(LoginDto loginDto);
    string GenerateJwtToken(int userId, string username);
}