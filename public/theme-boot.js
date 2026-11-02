// Runs blocking in <head> so data-theme is set before first paint. "system" stores nothing
// useful here: app.css follows prefers-color-scheme on its own.
try {
  var t = localStorage.getItem("atlas-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
