# DropBeam — Szybkie Przesyłanie Plików P2P (Netlify)

DropBeam to nowoczesna, w pełni statyczna aplikacja webowa umożliwiająca bezpośrednie przesyłanie plików między dwoma komputerami (lub telefonem i komputerem) za pomocą technologii **WebRTC DataChannel**.

---

## Dlaczego to idealne rozwiązanie na Netlify?

- **Brak limitów rozmiaru pliku**: Pliki nie są wgrywane na żaden serwer pośredniczący w chmurze ani do funkcji serverless. Przesył odbywa się bezpośrednio z pamięci jednego komputera do drugiego (streaming w pakietach po 64 KB z kontrolą bufora).
- **Maksymalna prędkość**: W tej samej sieci Wi-Fi/LAN transfer osiąga pełną przepustowość sieci lokalnej (często kilkadziesiąt/kilkaset MB/s).
- **100% Prywatności**: WebRTC automatycznie szyfruje połączenie (DTLS/SCTP). Twoje pliki nigdy nie są zapisywane na serwerach zewnętrznych.
- **Darmowy hosting na zawsze**: Aplikacja składa się w 100% z plików statycznych (`index.html`, `style.css`, `app.js`, `netlify.toml`), co sprawia, że mieści się w bezpłatnym planie Netlify z darmowym certyfikatem SSL HTTPS (wymaganym przez WebRTC).

---

## Jak wdrożyć aplikację na Netlify?

Masz do wyboru 3 proste sposoby:

### Sposób 1: Netlify Drop (Najszybszy — 30 sekund, bez instalacji)
1. Zaloguj się lub załóż bezpłatne konto na [Netlify](https://app.netlify.com/).
2. Przejdź do zakładki **Sites** lub otwórz bezpośrednio: [app.netlify.com/drop](https://app.netlify.com/drop).
3. Przeciągnij cały ten folder (`p2p-transfer`) i upuść go w wyznaczonym oknie w przeglądarce.
4. Netlify natychmiast opublikuje stronę i wygeneruje dla Ciebie unikalny adres HTTPS (np. `https://dropbeam-xyz.netlify.app`).

### Sposób 2: Netlify CLI (Z poziomu wiersza poleceń)
Jeśli masz zainstalowany Node.js, w folderze projektu uruchom:
```bash
npx netlify deploy --prod
```
Postępuj zgodnie z instrukcjami na ekranie (wskaż bieżący katalog jako publish directory).

### Sposób 3: Repozytorium GitHub
1. Wypchnij zawartość tego katalogu do nowego repozytorium na GitHubie.
2. W panelu Netlify wybierz **"Add new site" -> "Import an existing project" -> "GitHub"**.
3. Wybierz repozytorium — Netlify automatycznie wykryje plik `netlify.toml` i wdroży aplikację przy każdym kolejnym commicie.

---

## Jak przesyłać pliki między komputerami?

1. **Otwórz stronę na Komputerze A**:
   - Zobaczysz swój 6-cyfrowy kod PIN (np. `482 193`).
2. **Połącz Komputer B**:
   - **Metoda 1 (PIN)**: Na Komputerze B otwórz ten sam adres strony i wpisz kod `482-193` w pole „Połącz z drugim komputerem”, a następnie kliknij **Połącz**.
   - **Metoda 2 (Link)**: Na Komputerze A kliknij **Kopiuj link** (zawiera parametr `?room=482193`) i wyślij go (np. przez komunikator, maila) na Komputer B. Po otwarciu linku komputery połączą się automatycznie!
   - **Metoda 3 (QR)**: Kliknij ikonę QR i zeskanuj kod kamerą laptopa/smartfona.
3. **Prześlij pliki**:
   - Przeciągnij plik (lub kilka plików) na pole dropzone na jednym z komputerów.
   - Kliknij **Wyślij pliki**.
   - Na obu ekranach pojawi się pasek postępu w czasie rzeczywistym z aktualną prędkością transferu (MB/s).
   - Po odebraniu plik automatycznie pobierze się na dysk komputera odbiorcy.
