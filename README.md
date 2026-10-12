#Kişisel Kimlik ve Şifre Yöneticisi (Chrome Extension)

Güvenliğinizi ve kullanım kolaylığınızı ön planda tutan, modern arayüze sahip bağımsız bir Chrome uzantısı.

##Temel Özellikler

- **AES-256 Şifreleme:** Kasanız tarayıcı hafızasında Web Crypto API (PBKDF2 ve AES-GCM) ile uçtan uca şifrelenir.
- **Form İçi Hızlı Doldurma:** Sayfadaki şifre veya kart alanına tıklandığında beliren rozet ile tek tıkla otomatik doldurma.
- **Parola Sızıntı Kontrolü:** k-Anonimlik (SHA-1 hash) yöntemiyle şifrenizi dışarı göndermeden *Pwned Passwords API* üzerinden veri ihlallerini tarar.
- **Akıllı Site Eşleşmesi:** Bulunduğunuz web sitesini algılayıp ilgili hesapları listenin en üstünde önerir.
- **Canlı Geçici E-Posta:** *Guerrilla Mail API* ile anında çalışan geçici e-posta üretir ve gelen onay kodlarını doğrudan arayüzde gösterir.
- **Güvenli Notlar:** Wi-Fi parolaları, API anahtarları veya özel notlar için AES-256 korumalı güvenli not defteri.

##Kurulum (Geliştirici Modu)

1. Bu depoyu indirin (`Code > Download ZIP`) ve bir klasöre çıkartın.
2. Google Chrome'da `chrome://extensions/` adresine gidin.
3. Sağ üst köşedeki **"Geliştirici Modu" (Developer Mode)** seçeneğini açın.
4. Sol üstteki **"Paketlenmemiş öge yükle" (Load unpacked)** butonuna tıklayın ve klasörü seçin.
5. Eklenti simgeniz araç çubuğuna eklenecektir! 
