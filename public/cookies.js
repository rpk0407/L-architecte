// The cookie notice of the public site (site.html holds its styles). A file, not an inline script: the CSP is script-src 'self'.
(function () {
  var seen = false;
  try { seen = localStorage.getItem('lx-ck') === '1'; } catch (e) {}
  if (seen) return;
  var d = document.createElement('div');
  d.className = 'ck'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Cookies');
  d.innerHTML = '<p><b>Cookies.</b> Ce site utilise seulement ceux qui sont nécessaires : ta connexion, ta réservation, le paiement. Aucun suivi, aucune publicité.</p><div class="ck-r"><button type="button" class="ck-ok">OK</button><a href="/confidentialite#t-cookies">En savoir plus</a></div>';
  d.querySelector('.ck-ok').addEventListener('click', function () { try { localStorage.setItem('lx-ck', '1'); } catch (e) {} d.remove(); });
  var add = function () { document.body.appendChild(d); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
