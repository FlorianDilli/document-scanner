// viewport.js – standalone (home screen web app) viewport fix.
//
// Loaded as a blocking classic script BEFORE the stylesheet so the
// shell never paints short.
//
// iOS bug (WebKit 254868, still present in iOS 26.x): on the cold
// start of a standalone PWA, 100dvh / 100svh / innerHeight report
// the screen height MINUS the status-bar inset (~59px). The layout
// then ends ~59px above the physical bottom edge and iOS draws a
// system gap there. 100vh / 100lvh report the true full-screen
// height in standalone mode (there is no URL bar), so we pin the
// shell to 100vh. Browser mode keeps the CSS default (100dvh),
// which correctly tracks Safari's URL bar.
if (navigator.standalone === true) {
  document.documentElement.style.setProperty('--app-height', '100vh');
}
