# Camuflaje

Plataformas de trampas para navegador (Canvas 2D, JS vanilla, sin build tool). Nada es lo que parece: plataformas idénticas a las normales resultan mortales, el suelo se derrumba y las plataformas móviles no perdonan el timing.

Pensado para jugarse en institutos: sin WebGL (sobrevive a Chromebooks con política "no 3D"), sin descarga, sin cuenta, y con un modo Camuflaje (tecla `` ` ``) que disfraza la pantalla como un documento de Google Docs al instante.

## Cómo ejecutarlo

Sirve la carpeta con cualquier servidor estático (no funciona con `file://` porque los `<script>` se cargan como módulos separados):

```
npx serve .
```

y abre la URL que indique en el navegador.

## Estructura

- `index.html` — punto de entrada, HUD y overlays (menú, muerte, nivel completado)
- `style.css` — estilos, incluida la pantalla falsa del modo Camuflaje
- `src/engine.js` — físicas a paso fijo (1/60s) y colisiones
- `src/levels.js` — datos de los niveles (plataformas trampa, móviles, derrumbables, pinchos)
- `src/replay.js` — grabación de repeticiones y códigos de reto compartibles (fantasma asíncrono, sin backend)
- `src/camo.js` — modo Camuflaje (boss key)
- `src/ads.js` — integración de anuncios (Poki / CrazyGames / modo local sin anuncios)
- `src/main.js` — máquina de estados, render y enganche de todo lo anterior

## Cómo se juega

Flechas / WASD para moverte, Espacio o Arriba para saltar. Cada nivel se reinicia al instante al morir. Al completar un nivel puedes copiar un código corto y pasárselo a un compañero de clase: al pegarlo en el menú, corre contra tu "fantasma" en el mismo nivel.
