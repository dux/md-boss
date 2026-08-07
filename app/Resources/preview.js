// Preview page script. Lives in a real file rather than a Swift heredoc so the escapes
// stay readable and the regexes can be linted. Inlined into the page by MarkdownPageBuilder.
//
// Swift -> page: mdRender, mdSetTheme, mdSetFontSize, mdScrollToAnchor, mdScrollToFraction.
// Page -> Swift: window.webkit.messageHandlers.mdboss.postMessage({kind, ...}).

(function () {
  'use strict';

  var content = document.getElementById('content');
  var scheme = document.documentElement.getAttribute('data-filescheme');

  // Set around a programmatic scroll so the resulting event is not echoed back to Swift -
  // without it the editor and the preview drive each other in a loop.
  var suppressScrollEvents = false;
  var scrollFrame = null;

  function post(message) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mdboss) {
      window.webkit.messageHandlers.mdboss.postMessage(message);
    }
  }

  // A page error would otherwise be invisible - the preview would just render nothing.
  window.addEventListener('error', function (event) {
    post({ kind: 'error', message: String(event.message || event.type) });
  });

  // GitHub-style heading slugs, so #anchor links have something to land on.
  function assignSlugs() {
    var used = {};
    content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (heading) {
      if (heading.id) { return; }
      var slug = heading.textContent.toLowerCase().trim()
        .replace(/[^\w\- ]+/g, '')
        .replace(/\s+/g, '-');
      if (!slug) { return; }
      if (used[slug] === undefined) {
        used[slug] = 0;
      } else {
        used[slug] += 1;
        slug = slug + '-' + used[slug];
      }
      heading.id = slug;
    });
  }

  // A page loaded from a string cannot pull file:// subresources, so local images are
  // routed through the previewfile:// scheme handler instead.
  function rewriteLocalImages() {
    content.querySelectorAll('img').forEach(function (img) {
      if (img.src.indexOf('file://') !== 0) { return; }
      var path = decodeURIComponent(new URL(img.src).pathname);
      var binary = '';
      new TextEncoder().encode(path).forEach(function (byte) {
        binary += String.fromCharCode(byte);
      });
      var encoded = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      img.src = scheme + '://f/' + encoded;
    });
  }

  function highlight() {
    if (typeof hljs === 'undefined') { return; }
    hljs.configure({ ignoreUnescapedHTML: true });
    content.querySelectorAll('pre code').forEach(function (block) {
      // Per block: one unknown language must not blank the whole document.
      try { hljs.highlightElement(block); } catch (error) { /* leave it unhighlighted */ }
    });
  }

  window.mdRender = function (source) {
    var scroller = document.scrollingElement;
    var previousTop = scroller.scrollTop;

    marked.setOptions({ gfm: true, breaks: false, pedantic: false });
    content.innerHTML = marked.parse(source);

    assignSlugs();
    rewriteLocalImages();
    highlight();

    // Re-rendering while typing must not throw away the reader's place.
    scroller.scrollTop = previousTop;
  };

  window.mdSetTheme = function (css) {
    document.getElementById('theme').textContent = css;
  };

  window.mdSetFontSize = function (px) {
    document.documentElement.style.setProperty('--body-size', px + 'px');
  };

  window.mdSetMeasure = function (em) {
    document.documentElement.style.setProperty('--measure', em + 'em');
  };

  window.mdScrollToAnchor = function (id) {
    if (!id) { return; }
    var decoded = decodeURIComponent(id);
    var target = document.getElementById(decoded) || document.getElementsByName(decoded)[0];
    if (target) {
      target.scrollIntoView({ block: 'start' });
    } else {
      post({ kind: 'anchorMiss', id: decoded });
    }
  };

  window.mdScrollToFraction = function (fraction) {
    var scroller = document.scrollingElement;
    var range = scroller.scrollHeight - scroller.clientHeight;
    if (range <= 0) { return; }
    suppressScrollEvents = true;
    scroller.scrollTop = range * fraction;
  };

  // Same-document anchors are handled here and never reach the navigation delegate.
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest ? event.target.closest('a') : null;
    if (!anchor) { return; }
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) !== '#') { return; }
    event.preventDefault();
    window.mdScrollToAnchor(href.slice(1));
  });

  // Scroll reporting for split mode.
  document.addEventListener('scroll', function () {
    if (suppressScrollEvents) {
      suppressScrollEvents = false;
      return;
    }
    if (scrollFrame) { return; }
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = null;
      var scroller = document.scrollingElement;
      var range = scroller.scrollHeight - scroller.clientHeight;
      post({ kind: 'scroll', fraction: range > 0 ? scroller.scrollTop / range : 0 });
    });
  }, { passive: true });

  post({ kind: 'ready' });
})();
