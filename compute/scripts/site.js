/* Compute Futures — shared behavior. Progressive enhancement only:
   every page works with this file absent. */

(function () {
  // Reading-progress bar (walkthrough feel).
  var bar = document.querySelector('.progress');
  if (bar) {
    var onScroll = function () {
      var h = document.documentElement;
      var scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
      bar.style.width = Math.min(100, Math.max(0, scrolled * 100)) + '%';
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Mark the current page in the header nav.
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.headerNav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === here) a.classList.add('active');
  });
})();
