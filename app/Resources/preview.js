// Preview page script. Lives in a real file rather than a Swift heredoc so the escapes
// stay readable and the regexes can be linted. Inlined into the page by MarkdownPageBuilder.
//
// Swift -> page: mdRender, mdSetTheme, mdSetFontSize, mdSetMeasure, mdScrollToAnchor,
//                mdScrollToLine, mdSetNotes, mdHighlightLine.
// Page -> Swift: window.webkit.messageHandlers.mdboss.postMessage({kind, ...}).

(function () {
  'use strict';

  var content = document.getElementById('content');
  var scheme = document.documentElement.getAttribute('data-filescheme');

  // How long after a programmatic scroll the resulting events are ignored. One assignment
  // to scrollTop settles over several frames, and echoing those back would have the editor
  // and the preview drive each other in a loop.
  var SETTLE = 120;
  var suppressUntil = 0;
  var scrollFrame = null;

  // [{line, top}] for every [data-line], measured lazily and thrown away whenever the
  // layout could have moved under us.
  var anchors = null;
  // One past the last source line, so "at the end of the document" has a number.
  var totalLines = 1;

  // [{line, node}] for every [data-line]. Unlike `anchors` this depends only on the DOM,
  // not on where anything ended up, so it survives a resize or a font change.
  var blocks = null;
  // { "42": "note text" }, as Swift last sent it.
  var notes = {};
  // The source line a note jump landed on, or null.
  var targetLine = null;

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

  // MARK: source lines

  function newlines(text) {
    var count = 0;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) { count += 1; }
    }
    return count;
  }

  // Marked's tokens carry their source text but not their position, so the line a block
  // starts on is the running total of the newlines in everything before it.
  function stamp(html, line) {
    return html.replace(/^(\s*<[a-z][a-z0-9]*)/i, '$1 data-line="' + line + '"');
  }

  function toHTML(source) {
    var tokens = marked.lexer(source);
    var stamped = [];
    var html = '';
    var cursor = 0;
    var line = 1;

    tokens.forEach(function (token) {
      // Found back in the source rather than measured by adding up token.raw: link
      // reference definitions are lifted out of the stream entirely, and a running total
      // would swallow their lines and shift every block below them.
      var at = source.indexOf(token.raw, cursor);
      if (at < 0) { at = cursor; }
      line += newlines(source.slice(cursor, at));
      cursor = at + token.raw.length;

      var start = line;
      line += newlines(token.raw);

      // Those same definitions live on the token array, not on the tokens, so a single
      // token has to be handed the whole document's links to resolve [ref] style links.
      var one = [token];
      one.links = tokens.links;

      var piece = marked.parser(one);
      var tagged = stamp(piece, start);
      // Blank lines render to nothing, and a raw-HTML token can start with text; neither
      // gets an anchor.
      if (tagged !== piece) { stamped.push({ token: token, line: start }); }
      html += tagged;
    });

    totalLines = 1 + newlines(source);
    content.innerHTML = html;
    blocks = null;
    tagListItems(stamped);
  }

  // A thirty-item bullet list is a single token, and one anchor for thirty lines is the
  // largest remaining source of drift, so its items get their own. Matching is by document
  // order against the tokens that actually produced an anchor, which stays correct even
  // when a raw-HTML token emits several top-level elements.
  function tagListItems(stamped) {
    var elements = content.querySelectorAll(':scope > [data-line]');

    stamped.forEach(function (entry, position) {
      var node = elements[position];
      if (!node || entry.token.type !== 'list' || !entry.token.items) { return; }

      var raw = entry.token.raw;
      var items = node.children;
      var line = entry.line;
      var cursor = 0;

      entry.token.items.forEach(function (item, offset) {
        var at = raw.indexOf(item.raw, cursor);
        if (at < 0) { at = cursor; }
        line += newlines(raw.slice(cursor, at));
        cursor = at + item.raw.length;

        if (items[offset]) { items[offset].setAttribute('data-line', String(line)); }
        line += newlines(item.raw);
      });
    });
  }

  function invalidate() {
    anchors = null;
  }

  function anchorList() {
    if (anchors) { return anchors; }

    var offset = document.scrollingElement.scrollTop;
    var list = [];
    content.querySelectorAll('[data-line]').forEach(function (node) {
      list.push({
        line: Number(node.getAttribute('data-line')),
        top: node.getBoundingClientRect().top + offset
      });
    });
    list.sort(function (a, b) { return a.line - b.line || a.top - b.top; });

    anchors = list;
    return list;
  }

  // Index of the last entry whose `key` is at or before `value`.
  function bisect(list, key, value) {
    var low = 0;
    var high = list.length - 1;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (list[mid][key] <= value) { low = mid; } else { high = mid - 1; }
    }
    return low;
  }

  // MARK: notes

  function blockList() {
    if (blocks) { return blocks; }

    var list = [];
    content.querySelectorAll('[data-line]').forEach(function (node) {
      list.push({ line: Number(node.getAttribute('data-line')), node: node });
    });
    // Stable, so an <li> sharing its list's line still comes after the <ul> and wins below.
    list.sort(function (a, b) { return a.line - b.line; });

    blocks = list;
    return list;
  }

  // Which rendered block owns a source line: the last anchor at or before it. A note on
  // line 43 inside a paragraph that starts at 40 belongs to that paragraph.
  function blockFor(line) {
    var list = blockList();
    if (!list.length || line < list[0].line) { return null; }
    return list[bisect(list, 'line', line)].node;
  }

  // Hover text only - the page draws no marker of its own. `data-note` records what we
  // touched, so the next pass knows which titles are ours to clear.
  function applyNotes() {
    content.querySelectorAll('[data-note]').forEach(function (node) {
      node.removeAttribute('data-note');
      node.removeAttribute('title');
    });

    // Integer-like keys iterate in ascending order, so two notes folded into one block read
    // top to bottom.
    Object.keys(notes).forEach(function (key) {
      var node = blockFor(Number(key));
      if (!node) { return; }
      var existing = node.getAttribute('title');
      node.setAttribute('data-note', '');
      node.setAttribute('title', existing ? existing + '\n' + notes[key] : notes[key]);
    });
  }

  function markTarget() {
    var current = content.querySelector('.md-target');
    if (current) { current.classList.remove('md-target'); }
    if (targetLine === null) { return null; }

    var node = blockFor(targetLine);
    if (node) { node.classList.add('md-target'); }
    return node;
  }

  function maxScroll() {
    var scroller = document.scrollingElement;
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function topForLine(line) {
    var limit = maxScroll();
    var list = anchorList();
    if (!list.length || line > totalLines) { return limit; }
    if (line <= list[0].line) { return 0; }

    var index = bisect(list, 'line', line);
    var from = list[index];
    var to = list[index + 1];

    // Past the last block, the only thing left to interpolate against is the end of the
    // page - which is mostly the tall bottom padding.
    if (!to) {
      var tail = totalLines - from.line;
      return from.top + (limit - from.top) * (tail > 0 ? (line - from.line) / tail : 0);
    }

    var span = to.line - from.line;
    return from.top + (to.top - from.top) * (span > 0 ? (line - from.line) / span : 0);
  }

  function lineAtTop() {
    var top = document.scrollingElement.scrollTop;
    var limit = maxScroll();
    if (limit > 0 && top >= limit - 1) { return totalLines + 1; }

    var list = anchorList();
    if (!list.length) { return 1; }
    if (top <= list[0].top) { return list[0].line; }

    var index = bisect(list, 'top', top);
    var from = list[index];
    var to = list[index + 1];

    if (!to) {
      var tail = limit - from.top;
      return from.line + (totalLines - from.line) * (tail > 0 ? (top - from.top) / tail : 0);
    }

    var span = to.top - from.top;
    return from.line + (to.line - from.line) * (span > 0 ? (top - from.top) / span : 0);
  }

  // MARK: Swift -> page

  window.mdRender = function (source) {
    var scroller = document.scrollingElement;
    var previousTop = scroller.scrollTop;

    marked.setOptions({ gfm: true, breaks: false, pedantic: false });
    toHTML(source);

    assignSlugs();
    rewriteLocalImages();
    highlight();
    invalidate();
    // innerHTML threw both of these away with the old nodes.
    applyNotes();
    markTarget();

    // An image that has not arrived yet is still zero-height, so every anchor below it is
    // measured in the wrong place until it loads.
    content.querySelectorAll('img').forEach(function (img) {
      if (!img.complete) { img.addEventListener('load', invalidate, { once: true }); }
    });

    // Re-rendering while typing must not throw away the reader's place.
    scroller.scrollTop = previousTop;
  };

  window.mdSetTheme = function (css) {
    document.getElementById('theme').textContent = css;
    invalidate();
  };

  window.mdSetFontSize = function (px) {
    document.documentElement.style.setProperty('--body-size', px + 'px');
    invalidate();
  };

  window.mdSetMeasure = function (em) {
    document.documentElement.style.setProperty('--measure', em + 'em');
    invalidate();
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

  window.mdSetNotes = function (map) {
    notes = map || {};
    applyNotes();
  };

  window.mdHighlightLine = function (line) {
    targetLine = (line === null || line === undefined) ? null : line;

    var node = markTarget();
    if (!node) { return; }

    // Only when it is off screen. The scroll sync has usually brought it here already, and
    // a second scroll would fight it.
    var box = node.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) {
      suppressUntil = Date.now() + SETTLE;
      node.scrollIntoView({ block: 'center' });
    }
  };

  window.mdScrollToLine = function (line) {
    var limit = maxScroll();
    if (limit <= 0) { return; }

    suppressUntil = Date.now() + SETTLE;
    document.scrollingElement.scrollTop = Math.min(limit, Math.max(0, topForLine(line)));
  };

  // MARK: page -> Swift

  // Same-document anchors are handled here and never reach the navigation delegate.
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest ? event.target.closest('a') : null;
    if (!anchor) { return; }
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) !== '#') { return; }
    event.preventDefault();
    window.mdScrollToAnchor(href.slice(1));
  });

  // Notes anchor to a source line, so the native context menu needs to
  // know which block was right-clicked before it is built.
  content.addEventListener('contextmenu', function (event) {
    var node = event.target.closest ? event.target.closest('[data-line]') : null;
    post({ kind: 'context', line: node ? Number(node.getAttribute('data-line')) : 1 });
  });

  document.addEventListener('scroll', function () {
    if (Date.now() < suppressUntil) { return; }
    if (scrollFrame) { return; }
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = null;
      post({ kind: 'scroll', line: lineAtTop() });
    });
  }, { passive: true });

  window.addEventListener('resize', invalidate);

  post({ kind: 'ready' });
})();
