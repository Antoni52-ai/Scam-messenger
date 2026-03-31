using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Messenger.Data;
using Messenger.Models.Entity;
using Messenger.Hubs;
using Messenger.Services;
using Messenger.Services.Interfaces;

var builder = WebApplication.CreateBuilder(args);

// 🔹 PostgreSQL
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

// 🔹 Identity
builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
{
    options.Password.RequireDigit = false;
    options.Password.RequiredLength = 6;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequireUppercase = false;
    options.Password.RequireLowercase = false;
})
.AddEntityFrameworkStores<ApplicationDbContext>()
.AddDefaultTokenProviders();

// 🔹 MVC & SignalR
builder.Services.AddControllersWithViews();
builder.Services.AddSignalR();

// 🔹 Services
builder.Services.AddSingleton<IEncryptionService, EncryptionService>();
builder.Services.AddScoped<IMessageService, MessageService>();

// 🔹 CORS
builder.Services.AddCors(options =>
{
    var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
        ?? new[] { "https://localhost:5001", "http://localhost:5000" };

    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              .WithOrigins(allowedOrigins));
});

var app = builder.Build();

// 🔹 Auto-migrate database on startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        db.Database.Migrate();
        logger.LogInformation("Database migrated successfully");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to migrate database. Is PostgreSQL running?");
    }
}

// 🔹 Pipeline
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseCors("AllowAll");

app.UseAuthentication();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Chat}/{action=Index}/{id?}");

app.MapHub<ChatHub>("/hub/chat");

app.MapGet("/", () => Results.Redirect("/Chat"));

app.Run();
