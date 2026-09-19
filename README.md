# Camuflaje

Un plataformas de trampas para navegador donde nada es lo que parece: hay baldosas idénticas a las normales que te matan al pisarlas, suelos que se derrumban, otros que se voltean y se convierten en pinchos, bloques que se desploman encima y metas que se escapan cuando te acercas.

18 niveles, cada uno con su trampa protagonista. Partidas de segundos, reinicio instantáneo al morir y un contador de muertes que no perdona.

Cada nivel tiene además una **medalla de oro, plata o bronce** según el tiempo (los objetivos salen de partidas óptimas medidas, no inventadas) y una **pegatina escondida** fuera de la ruta cómoda: la del primer nivel está detrás del punto de salida, para que aprendas pronto a mirar atrás.

## Pensado para jugarse en el instituto

- **Sin WebGL.** Todo es Canvas 2D puro, así que funciona en Chromebooks de gama baja y sobrevive a las políticas de Chrome gestionado que desactivan el contenido 3D (desde Chrome 144 ya no hay respaldo por software: un juego con WebGL simplemente no arranca en esos equipos).
- **Sin descargas, sin cuenta, sin assets externos.** Gráficos, efectos y sonidos se generan por código.
- **Silenciado por defecto**, porque se juega en clase.
- **Modo Camuflaje**: la tecla `` ` `` convierte la pantalla al instante en un documento de Google Docs y pausa la partida.

## Cómo ejecutarlo

Sirve la carpeta con cualquier servidor estático (no vale abrir el archivo directamente con `file://`):

```
npx serve .
```

## Controles

| Acción | Teclas |
| --- | --- |
| Moverse | ← → o A / D |
| Saltar | Espacio, ↑ o W |
| Reiniciar nivel | R |
| Pausa | Esc |
| Camuflar la pantalla | `` ` `` |
| Silenciar | M |

También hay controles táctiles en móvil y tablet.

## Retar a un compañero

Al superar un nivel puedes copiar un código corto (20-200 caracteres) que contiene tu partida entera. Quien lo pegue en el menú corre contra tu fantasma en ese mismo nivel. No hace falta servidor ni cuenta: el código *es* la repetición.

Funciona porque la simulación es determinista (paso fijo de 1/60 s) y solo se guardan las teclas pulsadas en cada paso, comprimidas.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/engine.js` | Físicas y colisiones: paso fijo, colisión por ejes con subpasos, coyote time, buffer de salto, salto de altura variable, arrastre en plataformas móviles |
| `src/levels.js` | Los 18 niveles y el vocabulario de trampas |
| `src/replay.js` | Grabación de repeticiones y códigos de reto |
| `src/theme.js` | Dibujo: fondo con parallax, bloques con volumen, personaje animado |
| `src/fx.js` | Partículas, temblor de pantalla, hitstop y textos flotantes |
| `src/audio.js` | Efectos de sonido sintetizados con Web Audio (cero archivos) |
| `src/camo.js` | Modo Camuflaje |
| `src/ads.js` | Anuncios: Poki, CrazyGames o desactivado |
| `src/main.js` | Máquina de estados, cámara, HUD y el pegamento entre todo lo anterior |

## Publicar con anuncios

`src/ads.js` trae la integración de Poki y de CrazyGames. Para activarla, descomenta el `<script>` del SDK correspondiente en `index.html` y define `window.ADS_PROVIDER` a `"poki"` o `"crazygames"` antes de cargar `ads.js`. Por defecto está en `"none"` y no muestra nada.

Los anuncios solo aparecen en los cortes naturales (cada varias muertes), nunca durante la partida, y el de recompensa es opcional para saltarse un nivel atascado.
