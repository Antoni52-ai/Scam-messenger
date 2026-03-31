using System.Security.Cryptography;
using System.Text;

namespace Messenger.Services;

public interface IEncryptionService
{
    string Encrypt(string plainText);
    string Decrypt(string cipherText);
}

public class EncryptionService : IEncryptionService
{
    private const string DefaultKey = "NOVA_MESSENGER_DEV_KEY_32_BYTES!";
    private const string DefaultIV = "NOVA_CHAT_IV_16!";

    private readonly byte[] _key;
    private readonly byte[] _iv;

    public EncryptionService(IConfiguration config)
    {
        _key = ParseOrFallback(config["Encryption:Key"], 32, DefaultKey);
        _iv = ParseOrFallback(config["Encryption:IV"], 16, DefaultIV);
    }

    public string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText))
        {
            return plainText;
        }

        using var aes = Aes.Create();
        aes.Key = _key;
        aes.IV = _iv;

        using var ms = new MemoryStream();
        using (var cs = new CryptoStream(ms, aes.CreateEncryptor(), CryptoStreamMode.Write))
        {
            var plainBytes = Encoding.UTF8.GetBytes(plainText);
            cs.Write(plainBytes, 0, plainBytes.Length);
        }

        return Convert.ToBase64String(ms.ToArray());
    }

    public string Decrypt(string cipherText)
    {
        if (string.IsNullOrEmpty(cipherText))
        {
            return cipherText;
        }

        if (!TryDecodeBase64(cipherText, out var cipherBytes))
        {
            return cipherText;
        }

        try
        {
            using var aes = Aes.Create();
            aes.Key = _key;
            aes.IV = _iv;

            using var ms = new MemoryStream(cipherBytes);
            using var cs = new CryptoStream(ms, aes.CreateDecryptor(), CryptoStreamMode.Read);
            using var reader = new StreamReader(cs);

            return reader.ReadToEnd();
        }
        catch (CryptographicException)
        {
            // Stored with a different key in older builds.
            return "[message unavailable]";
        }
    }

    private static bool TryDecodeBase64(string value, out byte[] bytes)
    {
        try
        {
            bytes = Convert.FromBase64String(value);
            return true;
        }
        catch (FormatException)
        {
            bytes = Array.Empty<byte>();
            return false;
        }
    }

    private static byte[] ParseOrFallback(string? configuredValue, int expectedSize, string fallbackText)
    {
        if (!string.IsNullOrWhiteSpace(configuredValue) && TryDecodeBase64(configuredValue, out var asBase64))
        {
            if (asBase64.Length == expectedSize)
            {
                return asBase64;
            }
        }

        var source = string.IsNullOrWhiteSpace(configuredValue) ? fallbackText : configuredValue;
        var normalized = source.PadRight(expectedSize)[..expectedSize];
        return Encoding.UTF8.GetBytes(normalized);
    }
}
