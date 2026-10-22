# Розгортання ModernVid 2.0

Найпростіша схема: сервер і перекодування працюють на своєму комп'ютері, відео зберігаються
в хмарному S3-сховищі Backblaze B2, а доступ з Інтернету дає Cloudflare Tunnel.
Відео глядач завантажує безпосередньо з бакета, тому вихідний канал комп'ютера майже не
навантажується.

```
браузер ──https──▶ Cloudflare Tunnel ──▶ ModernVid (Node.js + FFmpeg) ──▶ MongoDB Atlas
   │                                            │
   └──── сегменти відео, пряме завантаження ────┴──▶ Backblaze B2 (S3 API)
```

## 1. Сховище Backblaze B2

1. Зареєструватися на <https://www.backblaze.com/sign-up/cloud-storage>. Під час реєстрації
   вибрати регіон **EU Central** (він закріплюється за обліковим записом). Банківська картка
   не потрібна: безкоштовно 10 ГБ даних і вихідний трафік до трикратного обсягу даних на місяць.
2. **Buckets → Create a Bucket**: унікальна назва (наприклад, `modernvid-<прізвище>`),
   *Files in Bucket*: **Private**, шифрування й Object Lock вимкнені.
3. На картці бакета скопіювати **Endpoint**, наприклад `s3.eu-central-003.backblazeb2.com`.
4. **Application Keys → Add a New Application Key**: доступ лише до цього бакета, тип
   *Read and Write*. Зберегти `keyID` і `applicationKey` — ключ показується один раз.
5. У файлі `.env`:

   ```
   STORAGE_DRIVER=s3
   S3_BUCKET=modernvid-<прізвище>
   S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
   S3_REGION=eu-central-003
   S3_ACCESS_KEY_ID=<keyID>
   S3_SECRET_ACCESS_KEY=<applicationKey>
   ```

6. Налаштувати CORS бакета (браузер завантажує частини файлу і відтворює сегменти напряму):

   ```
   npm run storage:setup
   ```

   Скрипт перевіряє доступ до бакета і виводить встановлені правила.

Обмеження безкоштовного тарифу B2 без картки — близько 2500 завантажень файлів на добу.
Перегляд 5-хвилинного відео складається приблизно з 75 сегментів, тобто це близько
30 повних переглядів на добу. Після вичерпання ліміту B2 до кінця доби відповідає помилкою;
нічого не списується. Якщо потрібно більше, задати `S3_MEDIA_MODE=proxy` (відео йде через
сервер, а бакет отримує ті самі запити) або перейти на Cloudflare R2 без плати за трафік.

Інші S3-сумісні сховища підключаються так само: Cloudflare R2
(`S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`), MinIO, AWS S3.

## 2. Запуск сервера

```
npm install
npm start
```

Для продуктивного режиму в `.env` також:

```
NODE_ENV=production        # захищені cookie (сайт відкривається лише через https)
TRUST_PROXY=loopback       # справжні IP-адреси клієнтів за тунелем (ліміти запитів)
FFMPEG_PATH=ffmpeg         # системний FFmpeg з підтримкою NVENC (winget install Gyan.FFmpeg)
FFPROBE_PATH=ffprobe
```

## 3. Публічна адреса: Cloudflare Tunnel

1. Встановити cloudflared: `winget install --id Cloudflare.cloudflared`.
2. Запустити тунель, коли сервер уже працює:

   ```
   cloudflared tunnel --url http://localhost:3000
   ```

3. У виводі з'явиться адреса `https://<випадкові-слова>.trycloudflare.com` — її можна
   надіслати іншим користувачам. Обліковий запис Cloudflare не потрібен; адреса змінюється
   після кожного перезапуску тунелю. Для постійної адреси потрібен власний домен у Cloudflare
   і іменований тунель (`cloudflared tunnel create`).

## 4. Docker (необов'язково)

```
docker compose up -d                    # сайт на http://localhost:3000
docker compose --profile tunnel up -d   # разом із Cloudflare Tunnel
docker compose logs tunnel              # публічна адреса
```

Образ містить системний FFmpeg; за локального сховища відео зберігаються в томі `media`.
