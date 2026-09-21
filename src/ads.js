/**
 * ============================================================================
 * ads.js — Integración de anuncios para "Camuflaje" (Canvas 2D, vanilla JS).
 * ============================================================================
 *
 * Fuentes oficiales consultadas (vía WebSearch; el fetch directo a estos
 * dominios estaba bloqueado por el proxy de red de este entorno, así que la
 * información se contrastó cruzando varias búsquedas — donde no se pudo
 * confirmar un nombre exacto se deja dicho explícitamente, en vez de
 * inventarlo):
 *
 *   POKI:
 *   - https://developers.poki.com/guide/sdk-overview   (SDK overview & events)
 *   - https://developers.poki.com/guide/requirements-quality
 *   - https://sdk.poki.com/html5                        (guía HTML5 vanilla)
 *   - https://www.npmjs.com/package/@poki/sdk            (wrapper npm oficial)
 *
 *   CRAZYGAMES:
 *   - https://docs.crazygames.com/sdk/intro/
 *   - https://docs.crazygames.com/sdk/game/              (game.* — loading / gameplay)
 *   - https://docs.crazygames.com/sdk/video-ads/         (ad.requestAd)
 *   - https://docs.crazygames.com/requirements/ads/      (política de anuncios)
 *
 * ----------------------------------------------------------------------------
 * CÓMO SE CARGA CADA SDK (antes que este archivo, por <script>)
 * ----------------------------------------------------------------------------
 *   Poki:       <script src="//game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
 *   CrazyGames: <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
 *
 * Ninguno de los dos se carga en index.html por defecto (desarrollo local usa
 * ADS_PROVIDER = 'none'); al publicar en uno de los dos portales, añadir el
 * <script> correspondiente antes de este archivo y cambiar ADS_PROVIDER.
 *
 * ----------------------------------------------------------------------------
 * NOMBRES REALES DE LAS FUNCIONES CLAVE
 * ----------------------------------------------------------------------------
 *                          POKI                            CRAZYGAMES (SDK v3)
 *  Loading terminado      PokiSDK.gameLoadingFinished()    sdk.game.loadingStop()
 *  Interstitial           PokiSDK.commercialBreak()        sdk.ad.requestAd("midgame", cbs)
 *  Rewarded               PokiSDK.rewardedBreak()          sdk.ad.requestAd("rewarded", cbs)
 *  Inicio de partida      PokiSDK.gameplayStart()          sdk.game.gameplayStart()
 *  Fin de partida         PokiSDK.gameplayStop()           sdk.game.gameplayStop()
 *
 * NOTA (Poki): la firma exacta de los argumentos opcionales de
 * commercialBreak()/rewardedBreak() no se pudo confirmar al 100% sin acceso
 * directo a developers.poki.com; por seguridad no se pasa ningún argumento
 * (ambos son opcionales). Revisar la guía oficial antes de publicar.
 *
 * NOTA (CrazyGames): esto asume SDK v3 (recomendado para proyectos nuevos).
 * La v2 legacy usa otros nombres (sdkGameLoadingStart/Finished).
 *
 * ----------------------------------------------------------------------------
 * POLÍTICAS RELEVANTES
 * ----------------------------------------------------------------------------
 * - gameplayStart()/gameplayStop() son OBLIGATORIOS en ambas plataformas y
 *   deben rodear cada tramo real de juego: NINGUNA de las dos muestra
 *   intersticiales mientras el gameplay está marcado como activo.
 *   gameplayStart() debe dispararse en el primer input del jugador, no al
 *   terminar de cargar.
 * - Ninguna plataforma necesita (ni quiere) que repliques su propio cooldown
 *   entre anuncios: ambas lo gestionan internamente. Basta con pedir el
 *   anuncio en cada punto natural (muerte, fin de nivel) y tratar un fallo
 *   (adError / rechazo de la promesa) como "no había anuncio, sigue el juego".
 * - Rewarded: solo dar la recompensa en el callback de éxito real
 *   (adFinished / success===true). Nunca recompensar en adError o fallo.
 */

let ADS_PROVIDER = (typeof window !== "undefined" && window.ADS_PROVIDER) || "none";

function safeCall(fn, ...args) {
  if (typeof fn !== "function") return;
  try {
    fn(...args);
  } catch (err) {
    console.error("[Ads] Error dentro de un callback del juego:", err);
  }
}

// Provider: NONE (desarrollo local / sin conexión a Poki o CrazyGames)
const NoneProvider = {
  init() {
    console.info('[Ads] ADS_PROVIDER = "none" — SDK de anuncios desactivado (modo local).');
    return Promise.resolve();
  },
  notifyGameplayStart() {},
  notifyGameplayStop() {},
  showInterstitial(callback) {
    queueMicrotask(() => safeCall(callback));
  },
  showRewarded(onSuccess, onFail) {
    // Por defecto se trata como éxito para poder probar en local el camino
    // de recompensa sin depender de Poki/CrazyGames.
    queueMicrotask(() => safeCall(onSuccess));
  },
};

// Provider: POKI (https://developers.poki.com/guide/sdk-overview)
const PokiProvider = {
  init() {
    if (typeof window === "undefined" || !window.PokiSDK) {
      console.warn('[Ads] ADS_PROVIDER = "poki" pero window.PokiSDK no existe (falta el <script> del SDK).');
      return Promise.resolve();
    }
    return window.PokiSDK.init()
      .then(() => {
        console.info("[Ads] Poki SDK inicializado.");
        window.PokiSDK.gameLoadingFinished();
      })
      .catch(() => {
        console.warn("[Ads] PokiSDK.init() falló; se continúa sin bloquear el juego.");
        if (window.PokiSDK.gameLoadingFinished) window.PokiSDK.gameLoadingFinished();
      });
  },
  notifyGameplayStart() {
    if (window.PokiSDK) window.PokiSDK.gameplayStart();
  },
  notifyGameplayStop() {
    if (window.PokiSDK) window.PokiSDK.gameplayStop();
  },
  showInterstitial(callback) {
    if (!window.PokiSDK) return queueMicrotask(() => safeCall(callback));
    window.PokiSDK.commercialBreak()
      .then(() => safeCall(callback))
      .catch((err) => {
        console.warn("[Ads] commercialBreak() rechazada:", err);
        safeCall(callback);
      });
  },
  showRewarded(onSuccess, onFail) {
    if (!window.PokiSDK) return queueMicrotask(() => safeCall(onFail));
    window.PokiSDK.rewardedBreak()
      .then((success) => safeCall(success ? onSuccess : onFail))
      .catch((err) => {
        console.warn("[Ads] rewardedBreak() rechazada:", err);
        safeCall(onFail);
      });
  },
};

// Provider: CRAZYGAMES (https://docs.crazygames.com/sdk/intro/, /sdk/game/, /sdk/video-ads/)
const CrazyGamesProvider = {
  _sdk: null,
  init() {
    if (typeof window === "undefined" || !window.CrazyGames || !window.CrazyGames.SDK) {
      console.warn('[Ads] ADS_PROVIDER = "crazygames" pero window.CrazyGames.SDK no existe (falta el <script> del SDK).');
      return Promise.resolve();
    }
    this._sdk = window.CrazyGames.SDK;
    return this._sdk
      .init()
      .then(() => {
        console.info("[Ads] CrazyGames SDK inicializado.");
        if (this._sdk.game && this._sdk.game.loadingStop) this._sdk.game.loadingStop();
      })
      .catch((err) => {
        console.warn("[Ads] CrazyGames SDK.init() falló; se continúa sin bloquear el juego.", err);
      });
  },
  notifyGameplayStart() {
    if (this._sdk && this._sdk.game) this._sdk.game.gameplayStart();
  },
  notifyGameplayStop() {
    if (this._sdk && this._sdk.game) this._sdk.game.gameplayStop();
  },
  showInterstitial(callback) {
    if (!this._sdk || !this._sdk.ad) return queueMicrotask(() => safeCall(callback));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      safeCall(callback);
    };
    this._sdk.ad.requestAd("midgame", {
      adFinished: () => finish(),
      adError: (err) => {
        console.warn("[Ads] midgame ad no disponible / error:", err);
        finish();
      },
    });
  },
  showRewarded(onSuccess, onFail) {
    if (!this._sdk || !this._sdk.ad) return queueMicrotask(() => safeCall(onFail));
    this._sdk.ad.requestAd("rewarded", {
      adFinished: () => safeCall(onSuccess),
      adError: (err) => {
        console.warn("[Ads] rewarded ad no disponible / error:", err);
        safeCall(onFail);
      },
    });
  },
};

function getActiveProvider() {
  switch (ADS_PROVIDER) {
    case "poki":
      return PokiProvider;
    case "crazygames":
      return CrazyGamesProvider;
    default:
      return NoneProvider;
  }
}

// Interfaz pública mínima usada por el motor del juego (igual sea cual sea
// ADS_PROVIDER).
const Ads = {
  init() {
    return getActiveProvider().init();
  },
  notifyGameplayStart() {
    getActiveProvider().notifyGameplayStart();
  },
  notifyGameplayStop() {
    getActiveProvider().notifyGameplayStop();
  },
  showInterstitial(callback) {
    getActiveProvider().showInterstitial(callback);
  },
  showRewarded(onSuccess, onFail) {
    getActiveProvider().showRewarded(onSuccess, onFail);
  },
};
