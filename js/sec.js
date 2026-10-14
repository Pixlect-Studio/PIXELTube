/* ============================================================
   CREATOR.HTML BOOTSTRAP
   If this page is loaded as creator.html, force the Studio view.
   ============================================================ */
if (document.body.dataset.page === 'creator') {
  /* Force the route to studio regardless of the hash */
  location.hash = '#/studio';
}

/* ---------- GO ---------- */
state.route = parseRoute();
renderTopbar();
renderSidebar();
render(true);
boot();