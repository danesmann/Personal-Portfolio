/* Vanilla client-side router (History API + fetch).
   Swaps only #view so the persistent shell (nav + <audio> + footer) is
   never reloaded — background music keeps playing across navigations.
   Also swaps page-specific <style> blocks so every route gets its own CSS.
   Progressive enhancement: if anything fails, links fall back to a
   normal full-page navigation, so the site always works.               */
(function(){
  var view = document.getElementById('view');
  if(!view || !window.history || !window.history.pushState || !window.fetch || !window.DOMParser) return;
  window.__spaWillMount = true;   // tell grid.js the router will own grid mounting

  // absolute URL of this script -> lets us find grid.js / three at site root
  var SELF = (document.currentScript && document.currentScript.src) ||
             (function(){ var s=document.querySelectorAll('script[src]'); for(var i=s.length-1;i>=0;i--){ if(/spa\.js(\?|$)/.test(s[i].src)) return s[i].src; } return location.href; })();
  var GRID_JS  = new URL('grid.js', SELF).href;
  var THREE_JS = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  var cache = {};

  // ---- style management -----------------------------------------------
  // styleCache maps pathname → array of <style> elements for that page.
  // When navigating, we disable the outgoing page's styles and enable (or
  // inject) the incoming page's styles, so each route gets its own CSS
  // without a full page reload.
  var styleCache = {};
  var curStylePath = location.pathname;

  // Stash the initial page's <style> elements under the current pathname.
  styleCache[curStylePath] = Array.prototype.slice.call(document.head.querySelectorAll('style'));

  function swapStyles(toPath, incomingDoc) {
    if (toPath === curStylePath) return;

    // Disable outgoing styles
    (styleCache[curStylePath] || []).forEach(function(el){ el.disabled = true; });

    if (!styleCache[toPath]) {
      // First visit to this path: extract <style> blocks from the fetched
      // document and append them to <head>.
      var added = [];
      incomingDoc.head.querySelectorAll('style').forEach(function(style){
        var el = document.createElement('style');
        el.textContent = style.textContent;
        document.head.appendChild(el);
        added.push(el);
      });
      styleCache[toPath] = added;
    } else {
      // Already visited: just re-enable the cached elements.
      styleCache[toPath].forEach(function(el){ el.disabled = false; });
    }

    curStylePath = toPath;
  }
  // -----------------------------------------------------------------------

  // Pin the shell's links to absolute URLs once, so pushState (which changes
  // the document base) can't re-resolve their relative hrefs incorrectly.
  function absolutizeShell(){
    document.querySelectorAll('nav a[href], footer a[href]').forEach(function(a){
      var h=a.getAttribute('href');
      if(h && h[0]!=='#' && !/^(mailto:|tel:|[a-z]+:\/\/)/i.test(h)) a.setAttribute('href', a.href);
    });
  }

  function isInternal(a){
    if(!a || !a.getAttribute) return false;
    if(a.target && a.target!=='_self') return false;
    if(a.hasAttribute('download') || a.hasAttribute('data-native')) return false;
    var h=a.getAttribute('href');
    if(!h || h[0]==='#' || /^(mailto:|tel:)/i.test(h)) return false;
    return a.origin===location.origin;
  }

  function loadScript(src){
    return new Promise(function(res, rej){
      var ex=document.querySelector('script[data-spa-src="'+src+'"]');
      if(ex){ res(); return; }
      var s=document.createElement('script');
      s.src=src; s.setAttribute('data-spa-src', src);
      s.onload=function(){ res(); }; s.onerror=function(){ rej(); };
      document.head.appendChild(s);
    });
  }

  // re-run any <script> inside the freshly-injected view (innerHTML won't)
  function runScripts(root){
    root.querySelectorAll('script').forEach(function(old){
      var s=document.createElement('script');
      for(var i=0;i<old.attributes.length;i++){ s.setAttribute(old.attributes[i].name, old.attributes[i].value); }
      s.textContent=old.textContent;
      old.parentNode.replaceChild(s, old);
    });
  }

  function setActive(){
    var path=location.pathname;
    document.querySelectorAll('nav a[href], .nav-links a[href]').forEach(function(a){
      var same=false; try{ same=new URL(a.href).pathname===path; }catch(e){}
      a.classList.toggle('active', same);
    });
  }

  // mount the home grid for the active view (lazy-load Three + grid.js)
  function mountView(){
    if(document.getElementById('gridCanvas')){
      var go=function(){ if(window.__remountGrid) window.__remountGrid(); };
      if(window.__remountGrid && window.THREE){ go(); return; }
      var p=window.THREE ? Promise.resolve() : loadScript(THREE_JS);
      p.then(function(){ return window.__remountGrid ? null : loadScript(GRID_JS); })
       .then(go).catch(function(){});
    }
  }

  function apply(html, url, push){
    var doc;
    try { doc=new DOMParser().parseFromString(html, 'text/html'); } catch(e){ location.href=url; return; }
    var incoming=doc.getElementById('view');
    if(!incoming){ location.href=url; return; }    // not a routable page -> hard nav
    // resolve the fragment's relative urls against the page it came from
    incoming.querySelectorAll('[src]').forEach(function(el){
      var v=el.getAttribute('src'); if(v) try{ el.setAttribute('src', new URL(v, url).href); }catch(e){}
    });
    incoming.querySelectorAll('a[href]').forEach(function(el){
      var v=el.getAttribute('href'); if(v && v[0]!=='#') try{ el.setAttribute('href', new URL(v, url).href); }catch(e){}
    });

    // Swap CSS before touching the DOM so the new layout paints in one go.
    swapStyles(new URL(url).pathname, doc);

    if(window.__disposeGrid) window.__disposeGrid();      // tear down old view (grid)
    document.title = doc.title || document.title;
    view.innerHTML = incoming.innerHTML;
    view.setAttribute('data-route', incoming.getAttribute('data-route') || '');
    if(push) history.pushState({spa:1}, '', url);
    runScripts(view);
    setActive();
    mountView();
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('spa:navigated', { detail:{ url:url } }));
  }

  function navigate(url, push){
    if(cache[url]){ apply(cache[url], url, push); return; }
    document.documentElement.classList.add('spa-loading');
    fetch(url, { credentials:'same-origin' })
      .then(function(r){ if(!r.ok) throw 0; return r.text(); })
      .then(function(html){ cache[url]=html; apply(html, url, push); })
      .catch(function(){ location.href=url; })
      .then(function(){ document.documentElement.classList.remove('spa-loading'); });
  }

  document.addEventListener('click', function(e){
    if(e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a=e.target.closest ? e.target.closest('a[href]') : null;
    if(!isInternal(a)) return;
    var url=a.href;
    e.preventDefault();
    if(new URL(url).pathname===location.pathname && !url.split('#')[1]){
      window.scrollTo({ top:0, behavior:'smooth' }); return;
    }
    navigate(url, true);
  });

  window.addEventListener('popstate', function(){ navigate(location.href, false); });

  absolutizeShell();
  setActive();
  mountView();   // mount grid if we landed directly on the home view
})();
