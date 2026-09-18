// Modo Camuflaje: al pulsar la tecla `~` (o el botón visible) la pantalla se
// convierte al instante en un falso documento de Google Docs y el juego se
// pausa. Volver a pulsar la misma tecla, o hacer clic en el documento, lo
// restaura. Pensado como "boss key" nativo, sin depender de una extensión
// que el instituto pueda bloquear.

const Camo = (() => {
  let overlayEl = null;
  let active = false;
  let onToggle = () => {};

  function build() {
    const el = document.createElement("div");
    el.id = "camo-overlay";
    el.innerHTML = `
      <div class="camo-bar">
        <span class="camo-bar-title">Trabajo de Lengua - Tema 4.docx</span>
      </div>
      <div class="camo-toolbar">Archivo &nbsp; Editar &nbsp; Ver &nbsp; Insertar &nbsp; Formato &nbsp; Herramientas</div>
      <div class="camo-page">
        <h1>Tema 4: El comentario de texto</h1>
        <p>El comentario de texto es una actividad que consiste en analizar un fragmento
        literario atendiendo a su forma y contenido. Para realizarlo correctamente conviene
        seguir una serie de pasos ordenados que permitan estructurar el análisis de manera
        coherente y completa.</p>
        <p>En primer lugar, es necesario realizar una lectura comprensiva del texto,
        identificando el tema principal y los subtemas que en él aparecen. A continuación,
        se debe analizar la estructura interna, distinguiendo las distintas partes del
        fragmento y la relación que existe entre ellas.</p>
        <p>Por último, se valorará el uso de los recursos estilísticos empleados por el
        autor, así como la intención comunicativa del texto...</p>
      </div>
    `;
    el.addEventListener("click", () => setActive(false));
    document.body.appendChild(el);
    return el;
  }

  function setActive(next) {
    if (!overlayEl) overlayEl = build();
    active = next;
    overlayEl.style.display = active ? "block" : "none";
    onToggle(active);
  }

  function toggle() {
    setActive(!active);
  }

  function init(callback) {
    onToggle = callback || (() => {});
    window.addEventListener("keydown", (e) => {
      if (e.key === "`" || e.key === "Dead" || e.code === "Backquote") {
        e.preventDefault();
        toggle();
      }
    });
  }

  return { init, toggle, isActive: () => active };
})();
