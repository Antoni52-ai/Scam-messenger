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
    private readonly byte[] _key;
    private readonly byte[] _iv;

    public EncryptionService(IConfiguration config)
    {
        var keyStr = config["Encryption:Key"] ?? GenerateKeyBase64();
        var ivStr = config["Encryption:IV"] ?? GenerateIVBase64();

        _key = Encoding.UTF8.GetBytes(keyStr.PadRight(32)[..32]);
        _iv = Encoding.UTF8.GetBytes(ivStr.PadRight(16)[..16]);
    }

    public string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText)) return plainText;

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
        if (string.IsNullOrEmpty(cipherText)) return cipherText;

        try
        {
            using var aes = Aes.Create();
            aes.Key = _key;
            aes.IV = _iv;

            var cipherBytes = Convert.FromBase64String(cipherText);
            using var ms = new MemoryStream(cipherBytes);
            using var cs = new CryptoStream(ms, aes.CreateDecryptor(), CryptoStreamMode.Read);
            using var reader = new StreamReader(cs);

            return reader.ReadToEnd();
        }
        catch (FormatException)
        {
            // Message was stored before encryption was enabled — return as-is
            return cipherText;
        }
        catch (CryptographicException)
        {
            // Message was stored with different key or unencrypted — return as-is
            return cipherText;
        }
    }

    private static string GenerateKeyBase64()
    {
        using var aes = Aes.Create();
        aes.GenerateKey();
        return Convert.ToBase64String(aes.Key);
    }

    private static string GenerateIVBase64()
    {
        using var aes = Aes.Create();
        aes.GenerateIV();
        return Convert.ToBase64String(aes.IV);
    }
}
