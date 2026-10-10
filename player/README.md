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
| `src` | адреса відео (MP4/WebM; HLS — наступний етап) |
| `poster` | обкладинка |
| `author-theme` | JSON з темою автора каналу (лише оформлення) |
| `preset` | JSON з пресетом глядача з сервера; якщо немає — береться збережений у браузері |

JS API: `el.core` (ядро: `play`, `pause`, `seek`, `setRate`, `bus.on('state', …)`), `el.config` (поточна конфігурація), `el.setViewerPreset(preset)`.

## Структура

```
src/
  core/PlayerCore.ts     ядро: стан відтворення, керування <video>, події
  core/EventBus.ts       шина подій між модулями
  core/sources.ts        обробники джерел (прогресивне; HLS/MSE — далі)
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

Доступні елементи: `play`, `rewind`, `forward`, `volume`, `time`, `spacer`, `speed`, `pip`, `fullscreen`.
