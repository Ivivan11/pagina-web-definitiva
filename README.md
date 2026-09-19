# Camuflaje

Un juego de parkour para navegador: corres sin poder parar, con algo detrás que no se cansa. Saltas huecos, haces la voltereta sobre las vallas, te deslizas bajo las vigas y rebotas en las paredes. Cada truco limpio te da velocidad y le saca metros al que te persigue; cada tropiezo se los regala.

Y no todo el suelo es suelo.

## Dos modos

- **Carrera** (`index.html`) — el juego principal. Recorrido infinito, generado con una semilla, que va presentando un verbo nuevo cada pocos cientos de metros.
  - **Carrera del día**: el mismo recorrido para todo el mundo, cambia cada día. Ideal para picarse en clase.
  - **Retos**: al acabar puedes copiar un código que lleva dentro la semilla y tu partida entera. Quien lo pegue corre *tu mismo recorrido* con tu fantasma al lado.
  - **Medallas** por distancia: bronce a 450 m, plata a 700 m, oro a 1100 m. Los umbrales no están puestos a ojo: salen de medir miles de carreras de bots con distinta pericia.
- **Niveles** (`niveles.html`) — 18 niveles de trampas hechos a mano, donde lo mortal es indistinguible de lo seguro. Medallas por tiempo y una pegatina escondida en cada uno.

## Pensado para jugarse en el instituto

- **Sin WebGL.** Todo es Canvas 2D puro, así que funciona en Chromebooks de gama baja y sobrevive a las políticas de Chrome gestionado que desactivan el contenido 3D (desde Chrome 144 ya no hay respaldo por software: un juego con WebGL simplemente no arranca).
- **Sin descargas, sin cuenta, sin assets externos.** Gráficos, efectos y sonidos se generan por código.
- **Silenciado por defecto**, porque se juega en clase.
- **Modo Camuflaje**: la tecla `` ` `` convierte la pantalla al instante en un documento de Google Docs y pausa la partida.
- Va sobrado de rendimiento: el juego ocupa un 3-4% del presupuesto de frame.

## Cómo ejecutarlo

Sirve la carpeta con cualquier servidor estático (no vale abrirlo con `file://`):

```
npx serve .
```

## Controles

| Acción | Teclas | Móvil |
| --- | --- | --- |
| Saltar / voltereta / rebote | Espacio, ↑ o W | mitad derecha |
| Deslizarte / rodar | ↓, S o Mayús | mitad izquierda |
| Pausa | Esc | botón Pausa |
| Camuflar la pantalla | `` ` `` | botón Camuflaje |
| Silenciar | M | botón Sonido |

El salto es contextual: cerca de una valla se convierte en voltereta, y contra una pared en rebote. Deslizarte en el aire te hace rodar al aterrizar sin perder velocidad.

## Reglas de diseño

Dos decisiones que se tomaron a base de medir, y que dan forma a todo lo demás:

1. **Ningún obstáculo te bloquea nunca.** Fallar significa superarlo de forma torpe perdiendo velocidad, no quedarte encallado. Solo matan los pinchos y los precipicios. (La primera versión te dejaba empotrado contra una valla hasta que te pillaban: insufrible.)
2. **Todo tiene que salvarse a la velocidad mínima.** Los huecos se dimensionan para poder saltarse yendo lento, porque tras un tropiezo vas lento y no puedes frenar. Antes, un hueco ancho tras un tropiezo era una muerte segura sin culpa del jugador: eso mataba al 26% de las carreras de un bot que jugaba perfecto, y ahora al 3%.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/parkour.js` | Simulación de la carrera: inercia, verbos de parkour, perseguidor y generación del recorrido con semilla |
| `src/run-replay.js` | Repeticiones y códigos de reto (la semilla viaja dentro del código) |
| `src/run-main.js` | Menú, carrera del día, medallas, récords y el render en silueta |
| `src/runner.js` | El corredor: esqueleto articulado dibujado por código, con sus posturas |
| `src/engine.js`, `src/levels.js`, `src/replay.js`, `src/theme.js`, `src/main.js` | El modo niveles |
| `src/fx.js` | Partículas, temblor de pantalla, hitstop y textos flotantes |
| `src/audio.js` | Efectos de sonido sintetizados con Web Audio (cero archivos) |
| `src/camo.js` | Modo Camuflaje |
| `src/ads.js` | Anuncios: Poki, CrazyGames o desactivado |

## Publicar con anuncios

`src/ads.js` trae la integración de Poki y de CrazyGames. Descomenta el `<script>` del SDK en `index.html` y define `window.ADS_PROVIDER` a `"poki"` o `"crazygames"` antes de cargar `ads.js`. Por defecto está en `"none"`.

Los anuncios solo salen en cortes naturales (cada cuatro carreras) y hay uno recompensado, opcional, para continuar donde te pillaron. Nunca durante la carrera.
