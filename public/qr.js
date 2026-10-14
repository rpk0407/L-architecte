/* Draws the QR code that opens the site on a phone, from whatever address this demo is served on. */
(function () {
  function draw() {
    var slot = document.querySelector('.qr-slot');
    if (!slot || slot.querySelector('svg') || typeof qrcode !== 'function') return;
    var url = new URL('site', location.href.split('#')[0]).href;
    var q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    var n = q.getModuleCount(), d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    slot.innerHTML = '<svg viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="QR code vers le site"><path fill="#0F0E0D" d="' + d + '"/></svg>';
    var u = document.querySelector('.qr-url');
    if (u) u.textContent = url.replace(/^https?:\/\//, '');
  }
  var t = setInterval(function () { draw(); if (document.querySelector('.qr-slot svg')) clearInterval(t); }, 300);
  setTimeout(function () { clearInterval(t); }, 20000);
  try { new MutationObserver(draw).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
})();
