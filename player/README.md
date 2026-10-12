# MVPlayer

Власний відеоплеєр платформи ModernVid 2.0. Написаний на TypeScript як вебкомпонент `<mv-player>` (Shadow DOM), без сторонніх бібліотек відтворення.

## Збірка

```bash
npm install            # один раз
npm run build:player   # збірка у public/mvplayer/mvplayer.js
npm run watch:player   # автоматична перезбірка під час розробки
npm run typecheck:player
```

`npm start` збирає плеєр автоматично (скрипт `prestart`).

## Використання

```html
<script type="module" src="/mvplayer/mvplayer.js"></script>
<mv-player src="/player/stream/ID" poster="thumb.jpg"
           author-theme='{"accent":"#3ea6ff"}'></mv-player>
```

| Атрибут | Призначення |
|---|---|
| `src` | адреса відео: HLS master-плейлист (`.m3u8`) або звичайний файл MP4/WebM |
| `fallback-src` | звичайний файл, якщо адаптивний потік відтворити неможливо |
| `poster` | обкладинка |
| `author-theme` | JSON з темою автора каналу (лише оформлення) |
| `preset` | JSON з пресетом глядача з сервера; якщо немає або порожній — береться збережений у браузері |
| `preview` | режим попереднього перегляду (редактор теми каналу): налаштування глядача не застосовуються і не змінюються |

JS API: `el.core` (ядро: `play`, `pause`, `seek`, `setRate`, `levels`, `setLevel(i | -1)`, `stats()`, `bus.on('state' | 'levelSwitch' | 'segment', …)`), `el.config`, `el.setViewerPreset(preset)`, `el.qoe()` (метрики QoE сеансу), `el.toggleStats()` (панель статистики, клавіша `i`), `el.toggleSettings()` (панель налаштувань, клавіша `s`), `el.getViewerPreset()`.

Події: `mv-ready` (завантажено метадані), `mv-preset-change` (глядач змінив налаштування; `detail.preset` — новий пресет, сторінка зберігає його на сервері через `PUT /api/presets/me`).

## Панель налаштувань

Кнопка «Settings» на панелі керування (або клавіша `s`) відкриває панель з вкладками: Look (кольори, прозорість, радіус, розмір кнопок, шрифт, використання теми каналу), Controls (конструктор розкладки: склад і порядок кнопок зліва і справа, автоприховування), Playback, Quality (режим ABR, максимальна роздільна здатність, алгоритм), Keys (перепризначення клавіш з перевіркою конфліктів), Preset (експорт / імпорт JSON, скидання). Зміни застосовуються одразу і зберігаються як пресет глядача.

Серверний API (`routes/presets.js`): `GET/PUT/DELETE /api/presets/me` — пресет глядача, `GET /api/presets/channel/:userId`, `PUT/DELETE /api/presets/channel` — тема каналу (лише група `theme`). Усі дані перевіряються `utils/presetValidation.js`.

## Структура

```
src/
  core/PlayerCore.ts     ядро: стан відтворення, керування <video>, події
  core/EventBus.ts       шина подій між модулями
  core/sources.ts        обробники джерел: прогресивне відтворення або HLS-рушій
  core/QoeTracker.ts     метрики QoE: час старту, зупинки, перемикання, середній бітрейт, QoE (1.2)
  streaming/m3u8.ts      розбір master- і media-плейлистів HLS
  streaming/HlsEngine.ts HLS-рушій на MSE / ManagedMediaSource: буфер, сегменти, перемикання якості
  abr/ThroughputEstimator.ts  оцінка пропускної здатності (швидке і повільне EWMA)
  abr/algorithms.ts      ABR-алгоритми: throughput, buffer (BBA), hybrid, adaptive (запропонований)
  config/types.ts        схема конфігурації (тема, розкладка, поведінка, клавіші)
  config/defaults.ts     системні налаштування за замовчуванням
  config/merge.ts        ієрархія пресетів: система → автор → глядач
  ui/controls.ts         реєстр елементів керування (можна додавати плагінами)
  ui/ProgressBar.ts      шкала перемотування
  ui/styles.ts           CSS і перетворення теми в CSS-змінні
  hotkeys.ts             гарячі клавіші та перевірка конфліктів
  storage.ts             збереження налаштувань глядача в браузері
  MVPlayerElement.ts     вебкомпонент <mv-player>
```

## Пресет глядача (приклад)

```json
{
  "theme": { "accent": "#22c55e", "controlSize": "large", "radius": 14 },
  "layout": { "left": ["play", "time"], "right": ["volume", "speed", "fullscreen"], "autoHide": false },
  "behavior": { "seekStep": 5, "rememberSpeed": true },
  "hotkeys": { "togglePlay": [" "], "toggleFullscreen": ["f", "Enter"] }
}
```

Доступні елементи: `play`, `rewind`, `forward`, `volume`, `time`, `spacer`, `speed`, `quality`, `pip`, `fullscreen`.

## Якість відтворення (група `quality` пресету)

```json
{ "quality": { "algorithm": "adaptive", "mode": "balanced", "maxHeight": 720 } }
```

- `algorithm`: `adaptive` (вдосконалений гібридний, за замовчуванням), `hybrid`, `throughput`, `buffer`;
- `mode`: `balanced`, `quality` (максимальна якість), `stable` (менше перемикань), `eco` (економія трафіку, до 480p);
- `maxHeight`: обмеження роздільної здатності (за коротшою стороною) або `null`.
