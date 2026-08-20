/**
 * The Wallpaper Engine Web API shim, served to web-type wallpaper iframes.
 *
 * Web wallpapers are authored against APIs that Wallpaper Engine injects
 * into its CEF host before the page scripts run: property listeners (user
 * customization values), the audio-level listener (64 stereo bands), and
 * LED/RGB hardware hooks. Inside the skin center there is no editor session
 * and no hardware, so the shim installs benign defaults: user properties are
 * seeded from the wallpaper's project.json defaults and delivered once the
 * page registers its listener, the audio listener registers but is fed
 * silence, and hardware APIs become no-ops. Wallpapers that never touch these
 * APIs are unaffected; wallpapers that do degrade to their non-reactive
 * visuals instead of crashing on undefined globals.
 * @module @linxin666/dsh-client-ui-skin-center/we-shim-source
 */

/** The shim source, injected ahead of every web wallpaper HTML document. */
export const WE_SHIM_JS = [
  '(function () {',
  "  if (window.__dshWeShim) return;",
  "  window.__dshWeShim = true;",
  '  var props = {};',
  '  var defaults = window.__dshWeDefaultProps || {};',
  '  for (var dk in defaults) { props[dk] = defaults[dk]; }',
  '  window.wallpaperPropertyListener = {',
  '    applyUserProperties: function (p) {',
  '      if (p && typeof p === "object") { for (var k in p) { props[k] = p[k]; } }',
  '    },',
  '    applyGeneralProperties: function () {},',
  '    setUserProperty: function (k, v) { props[k] = v; },',
  '    getUserProperty: function (k) { return props[k]; }',
  '  };',
  '  // WE delivers the property defaults once the page listener is in place.',
  '  // Wallpapers typically replace wallpaperPropertyListener with their own',
  '  // object; frameworks (Angular etc.) bootstrap asynchronously and may not',
  '  // survive property delivery before their services are ready, so deliver',
  '  // at a few staggered points after load.',
  '  var deliver = function () {',
  '    try {',
  '      var l = window.wallpaperPropertyListener;',
  '      if (l && typeof l.applyUserProperties === "function" && Object.keys(defaults).length) {',
  '        l.applyUserProperties(defaults);',
  '      }',
  '    } catch (e) {}',
  '  };',
  '  var kick = function () {',
  '    var delays = [800, 2000, 4000];',
  '    for (var di = 0; di < delays.length; di++) {',
  '      setTimeout(deliver, delays[di]);',
  '    }',
  '  };',
  "  if (document.readyState === 'complete') { kick(); }",
  "  else { window.addEventListener('load', kick); }",
  '  var audioListener = null;',
  '  window.wallpaperRegisterAudioListener = function (cb) {',
  '    if (typeof cb === "function") audioListener = cb;',
  '  };',
  '  // Silence buffer WE wallpapers expect: 64 bands x 2 channels.',
  '  var silence = [];',
  '  for (var i = 0; i < 128; i++) silence.push(0);',
  '  window.__dshWeAudio = {',
  '    listener: function () { return audioListener; },',
  '    silence: silence,',
  '    pump: function () { if (audioListener) { try { audioListener(silence); } catch (e) {} } }',
  '  };',
  '  window.wallpaperRegisterLEDColorListener = function () {};',
  '  window.wallpaperRegisterFPSListener = function () {};',
  '})();',
  '',
].join('\n')
