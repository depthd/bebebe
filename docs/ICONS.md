# Иконки (генерируются в Qwen)

Готовую картинку кладёшь в `src/assets/icons/<имя>.png`, игра подхватывает её сама. Пока файла нет, на этом месте временная заглушка.

## Общий промт

Одинаковый для всех, меняется только `{WHAT}`. Так иконки выйдут в одном стиле.

```
Game UI icon: {WHAT}.
Flat cartoon style, thick dark outline, bold simple shapes, 2–3 bright colors, slight soft shading,
centered, fills most of the frame, no text, no letters.
Plain pure white background. Square 512x512.
```

Если Qwen умеет прозрачный фон, попроси `transparent background` вместо белого. Если нет, белый фон я вырежу сам.

## Что нужно

По важности: первые 8 видны постоянно, остальные — когда держишь предмет или открыл телефон.

| Файл | Где видно | `{WHAT}` |
|---|---|---|
| `alert.png` | над пацаном, у которого проблема | `a red exclamation mark in a round badge` |
| `booze.png` | над столом и в HUD: сколько бухла на столе | `a glass bottle of beer next to a shot glass of vodka` |
| `food.png` | над столом и в HUD: сколько еды | `a plate with a slice of pizza and dumplings` |
| `energy.png` | силы Олега | `a yellow lightning bolt` |
| `fun.png` | общее веселье | `a laughing face with party confetti` |
| `hut.png` | состояние хаты | `a small cozy apartment building with a crack on the wall` |
| `neighbours.png` | злость соседей | `an angry fist knocking on a door` |
| `money.png` | деньги в телефоне | `a stack of ruble banknotes` |
| `beer.png` | предмет в руках, магазин | `a brown glass bottle of beer` |
| `vodka.png` | предмет в руках, магазин | `a bottle of vodka with a red label` |
| `pelmeni.png` | магазин, плита | `a pack of frozen dumplings (pelmeni)` |
| `pizza.png` | магазин | `a pizza in an open box` |
| `mop.png` | тряпка в руках | `a wet floor rag cloth` |
| `tools.png` | инструменты в руках | `a hammer and a screwdriver crossed` |
| `toy.png` | мышка для кота | `a grey toy mouse for a cat` |
| `shower.png` | лейка душа в руках | `a chrome hand shower head with a hose, water drops` |
| `cat.png` | кот на руках | `a fluffy black Persian cat with big orange eyes, curled up` |
| `talk.png` | можно поговорить | `a speech bubble with three dots` |
| `camera.png` | телефон: камера у двери | `a security camera` |
| `cart.png` | телефон: доставка | `a delivery scooter with a box` |
