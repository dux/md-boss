// Preview page script, inlined into the preview iframe by src/preview/page.ts.
//
// App -> page: mdRender, mdSetTheme, mdSetFontSize, mdSetMeasure, mdScrollToAnchor,
//              mdScrollToLine, mdSetNotes, mdHighlightLine, mdSetBase - called on the
//              iframe's window.
// Page -> app: window.parent.postMessage({kind, ...}) - the pane listens for "message".

(function () {
  'use strict';

  var content = document.getElementById('content');
  // Where a local image can be loaded from: the app's asset protocol prefix, to which the
  // encoded path is appended. Empty when there is none - then a file: image is left alone.
  var assetBase = document.documentElement.getAttribute('data-asset-base') || '';

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
  // [{key, line}] for typed blocks Fez may have replaced with its own root node.
  var typedLines = [];
  var typedRender = 0;

  function post(message) {
    // srcdoc is same-origin with the pane, so the target origin is ours.
    window.parent.postMessage(message, window.location.origin === 'null' ? '*' : window.location.origin);
  }

  // A page error would otherwise be invisible - the preview would just render nothing.
  window.addEventListener('error', function (event) {
    post({ kind: 'error', message: String(event.message || event.type) });
  });

  // The app's shortcuts, pressed while the reader's focus is in the page. Key events do not
  // leave an iframe, so the ones the app could answer are handed to the pane, which replays
  // them on its own window. Nothing is prevented here - Copy and the like stay the page's.
  window.addEventListener('keydown', function (event) {
    if (!event.metaKey && !event.ctrlKey && event.key !== 'Backspace') { return; }
    post({
      kind: 'key',
      code: event.code,
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey
    });
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

  // A page loaded from a string cannot pull file:// subresources, so local images - which
  // the <base> has resolved to file: URLs - are routed through the asset protocol instead.
  function rewriteLocalImages() {
    if (!assetBase) { return; }
    content.querySelectorAll('img').forEach(function (img) {
      if (img.src.indexOf('file://') !== 0) { return; }
      var path = decodeURIComponent(new URL(img.src).pathname);
      // file:///C:/x parses to the pathname /C:/x.
      if (/^\/[A-Za-z]:/.test(path)) { path = path.slice(1); }
      img.src = assetBase + encodeURIComponent(path);
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

  // MARK: task lists

  // GFM wants a bullet before the box; a bare `[x] item` line is what people actually type,
  // so it gets the bullet here. Same line count, so every anchor below stays put. `[o]` is
  // ours - a third state, still running - and rides through the lexer as plain text. `[*]`
  // spells the same state, kept because documents already carry it.
  var TASK = /^([ \t]*)\[([ xXoO*])\]([ \t])/;
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;

  function expandTasks(source) {
    var lines = source.split('\n');
    var fence = null;

    for (var i = 0; i < lines.length; i += 1) {
      var open = FENCE.exec(lines[i]);
      if (open) {
        var mark = open[1].charAt(0);
        if (!fence) { fence = mark; } else if (mark === fence) { fence = null; }
      } else if (!fence) {
        lines[i] = lines[i].replace(TASK, '$1- [$2]$3');
      }
    }
    return lines.join('\n');
  }

  // The text node an item starts with - directly for a tight list, inside the wrapping <p>
  // for a loose one.
  function itemHead(item) {
    var node = item.firstChild;
    if (node && node.nodeType === 1 && node.tagName === 'P') { node = node.firstChild; }
    return node && node.nodeType === 3 ? node : null;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Two arcs on one circle: the whole ring in the border ink, and a quarter of it in the
  // accent, turning. An SVG rather than a bordered box because a border can only be a whole
  // ring or four separately coloured sides - the head needs a rounded cap and a length that
  // does not answer to the box model. Sized in em by the stylesheet, so it tracks the text.
  function spinnerSvg() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'md-spinner');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'in progress');

    var track = document.createElementNS(SVG_NS, 'circle');
    track.setAttribute('class', 'md-spinner-track');
    track.setAttribute('cx', '8');
    track.setAttribute('cy', '8');
    track.setAttribute('r', '6.4');

    // A quarter turn, drawn from twelve o'clock.
    var head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('class', 'md-spinner-head');
    head.setAttribute('d', 'M8 1.6a6.4 6.4 0 0 1 6.4 6.4');

    svg.appendChild(track);
    svg.appendChild(head);
    return svg;
  }

  // `[o]` arrives as literal text at the head of the item; swapping it for a spinner here
  // keeps the third state out of the lexer entirely. Boxed items are tagged in the same
  // pass rather than matched in CSS, because a loose list wraps the item in a <p> and no
  // child selector survives that.
  function markTasks() {
    content.querySelectorAll('li').forEach(function (item) {
      var head = itemHead(item);
      var match = head && /^\[[oO*]\][ \t]/.exec(head.nodeValue);

      if (match) {
        head.nodeValue = head.nodeValue.slice(match[0].length);
        head.parentNode.insertBefore(spinnerSvg(), head);
        item.classList.add('md-task');
        return;
      }

      // A nested list's checkbox belongs to its own item, not to this one.
      var box = item.querySelector('input[type="checkbox"]');
      if (!box || box.closest('li') !== item) { return; }
      item.classList.add('md-task');

      // Marked leaves the space it split the item on sitting after the box, which would put
      // the text a quarter em right of where a spinner puts it. The marker owns that gap.
      var text = box.nextSibling;
      if (text && text.nodeType === 3) { text.nodeValue = text.nodeValue.replace(/^\s+/, ''); }
    });
  }

  // The indexes name tasks in the same document order markTasks uses. Particles are siblings
  // of the input so they can radiate around it without changing the task's layout or tick.
  function celebrateTasks(indexes) {
    if (!indexes || !indexes.length) { return; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    var tasks = content.querySelectorAll('li.md-task');

    indexes.forEach(function (index) {
      var task = tasks[index];
      if (!task) { return; }
      var box = task.querySelector('input[type="checkbox"]:checked');
      if (!box || box.closest('li') !== task) { return; }

      var burst = document.createElement('span');
      burst.className = 'md-confetti-burst';
      burst.setAttribute('aria-hidden', 'true');
      var count = 20;
      for (var i = 0; i < count; i += 1) {
        var angle = (Math.PI * 2 * i / count) - Math.PI / 2;
        var distance = 1.8 + (i % 4) * 0.35;
        var x = Math.cos(angle) * distance;
        var y = Math.sin(angle) * distance + 0.45;
        var turn = (i % 2 ? 1 : -1) * (150 + i * 23);
        var particle = document.createElement('i');
        particle.className = 'md-confetti-particle md-confetti-color-' + (i % 6)
          + (i % 4 === 0 ? ' md-confetti-round' : '');
        particle.style.setProperty('--confetti-x', x.toFixed(2) + 'em');
        particle.style.setProperty('--confetti-y', y.toFixed(2) + 'em');
        particle.style.setProperty('--confetti-mid-x', (x * 0.62).toFixed(2) + 'em');
        particle.style.setProperty('--confetti-mid-y', (y * 0.62).toFixed(2) + 'em');
        particle.style.setProperty('--confetti-turn', turn + 'deg');
        particle.style.setProperty('--confetti-mid-turn', Math.round(turn * 0.55) + 'deg');
        particle.style.setProperty('--confetti-delay', ((i % 5) * 12) + 'ms');
        particle.style.setProperty('--confetti-duration', (760 + (i % 4) * 70) + 'ms');
        burst.appendChild(particle);
      }
      box.insertAdjacentElement('afterend', burst);
      var remove = function () { burst.remove(); };
      burst.lastChild.addEventListener('animationend', remove, { once: true });
      window.setTimeout(remove, 1200);
    });
  }

  // MARK: alerts

  // `> [!NOTE]` and its four siblings. A DOM pass after render rather than a lexer extension,
  // for the same reason task lists are one: the tokens keep their raw text, so every data-line
  // below stays exactly where it was.
  //
  // `breaks: false`, so the marker and the body arrive as one text node split by a newline -
  // the marker is a prefix to strip, not a node to remove.
  var ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\n|$)/;

  var ALERT_TITLES = {
    NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution'
  };

  function markAlerts() {
    content.querySelectorAll('blockquote').forEach(function (quote) {
      var head = quote.firstElementChild;
      if (!head || head.tagName !== 'P') { return; }

      var lead = head.firstChild;
      if (!lead || lead.nodeType !== 3) { return; }

      var match = ALERT.exec(lead.nodeValue);
      if (!match) { return; }

      // Only the marker goes. An alert whose body starts on the same paragraph keeps it; one
      // with nothing after the marker loses the now-empty paragraph rather than an empty line.
      lead.nodeValue = lead.nodeValue.slice(match[0].length);
      // Two spaces after the marker make it a hard break, and the alert would open on a blank
      // line. The marker owns that break the same way it owns its newline.
      if (!lead.nodeValue && lead.nextSibling && lead.nextSibling.nodeName === 'BR') {
        lead.nextSibling.remove();
      }
      if (!lead.nodeValue && !lead.nextSibling) { head.remove(); }

      quote.classList.add('md-alert', 'md-alert-' + match[1].toLowerCase());

      var title = document.createElement('p');
      title.className = 'md-alert-title';
      title.textContent = ALERT_TITLES[match[1]];
      quote.insertBefore(title, quote.firstChild);
    });
  }

  // MARK: front matter

  // `key: value` in a leading `---` block. Deliberately shallow - a nested map or a block
  // scalar is shown as text rather than parsed. This is a reading affordance, not YAML.
  var FRONT_PAIR = /^([^:\s][^:]*):(?:[ \t]+(.*))?$/;

  function escapeHTML(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // A `---` block at the very top of the file. Null for anything else, a `---` with no closer
  // included - that is a thematic break and has always rendered as one.
  //
  // Split off rather than stripped, with `toHTML` starting its line counter past it. Blanking
  // the lines instead would hand `blankBreaks` a run of them and open every document with
  // stray <br>s.
  function splitFront(source) {
    var lines = source.split('\n');
    if (lines[0].trim() !== '---') { return null; }

    for (var i = 1; i < lines.length; i += 1) {
      var edge = lines[i].trim();
      if (edge !== '---' && edge !== '...') { continue; }
      return {
        pairs: frontPairs(lines.slice(1, i)),
        lines: i + 1,
        body: lines.slice(i + 1).join('\n')
      };
    }
    return null;
  }

  // A line that is not `key: value` continues the value above it, which is what a list or a
  // wrapped string looks like from here. One with nothing above it is dropped.
  function frontPairs(lines) {
    var pairs = [];
    lines.forEach(function (line) {
      var pair = FRONT_PAIR.exec(line);
      if (pair) {
        pairs.push({ key: pair[1].trim(), value: (pair[2] || '').trim() });
      } else if (pairs.length && line.trim()) {
        // A list under a key reads as a list; anything else is a scalar that wrapped, so it
        // joins back on a space. The dash belongs to the syntax, not to the value.
        var item = /^-[ \t]+(.*)$/.exec(line.trim());
        var last = pairs[pairs.length - 1];
        var text = item ? item[1] : line.trim();
        last.value = last.value ? last.value + (item ? ', ' : ' ') + text : text;
      }
    });
    return pairs;
  }

  // Drawn rather than hidden: `blockFor` gives a source line the last anchor at or before it,
  // so with nothing above the first heading a note on line 2 would have no block to hang on.
  function frontHTML(front) {
    if (!front.pairs.length) { return ''; }

    var rows = front.pairs.map(function (pair) {
      return '<dt>' + escapeHTML(pair.key) + '</dt><dd>' + escapeHTML(pair.value) + '</dd>';
    });
    return '<dl class="md-front" data-line="1">' + rows.join('') + '</dl>';
  }

  // MARK: typed Fez blocks

  // A comment token is its own Markdown block without adding a source line. Replacing the
  // typed markers with inert comments before lexing lets everything between them remain
  // ordinary Markdown, then the DOM pass below swaps each pair for its installed Fez tag.
  function markTypedSource(source, lineOffset, typed) {
    var lines = source.split('\n');
    typed.forEach(function (block, index) {
      var open = block.openLine - lineOffset - 1;
      var close = block.closeLine - lineOffset - 1;
      if (open < 0 || close <= open || close >= lines.length) { return; }
      lines[open] = '<!--mdboss-typed-open-' + index + '-->';
      lines[close] = '<!--mdboss-typed-close-' + index + '-->';
    });
    return lines.join('\n');
  }

  function commentNamed(name) {
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_COMMENT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue === name) { return node; }
    }
    return null;
  }

  function restoreTypedLines() {
    typedLines.forEach(function (entry) {
      var node = content.querySelector('[fez-key="' + entry.key + '"]');
      if (node) { node.setAttribute('data-line', String(entry.line)); }
    });
  }

  function mountTypedBlocks(typed) {
    typedRender += 1;
    typedLines = [];
    // Smallest spans first, so a nested child becomes one node the parent can move.
    var ordered = typed.map(function (block, index) {
      return { block: block, index: index };
    }).sort(function (a, b) {
      return (a.block.closeLine - a.block.openLine) - (b.block.closeLine - b.block.openLine);
    });

    ordered.forEach(function (entry) {
      var block = entry.block;
      var open = commentNamed('mdboss-typed-open-' + entry.index);
      var close = commentNamed('mdboss-typed-close-' + entry.index);
      if (!open || !close || open.parentNode !== close.parentNode) { return; }

      var component = document.createElement('md-' + block.type);
      Object.keys(block.attributes || {}).forEach(function (name) {
        component.setAttribute(name, block.attributes[name]);
      });
      var key = 'md-typed-' + typedRender + '-' + entry.index;
      component.setAttribute('fez-key', key);
      component.setAttribute('data-line', String(block.openLine));

      var node = open.nextSibling;
      while (node && node !== close) {
        var next = node.nextSibling;
        component.appendChild(node);
        node = next;
      }
      open.parentNode.insertBefore(component, open);
      open.remove();
      close.remove();
      typedLines.push({ key: key, line: block.openLine });
    });

    // A connected Fez component replaces its custom tag synchronously once the document is
    // loaded. During initial srcdoc loading that replacement waits for a frame, so this is
    // called both now and from mdRender's post-mount frame.
    restoreTypedLines();
  }

  // MARK: source lines

  function newlines(text) {
    var count = 0;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) { count += 1; }
    }
    return count;
  }

  // Markdown folds any run of blank lines into a single break, but someone who left three of
  // them in the file meant to see three. The ordinary gap between two blocks is two newlines -
  // the one that ends the block plus the blank line - and every one past that comes back as a
  // <br>. Where the run sits depends on the block: headings, tables and raw HTML swallow the
  // blank lines below them into their own text while everything else leaves them to a `space`
  // token, so counting the whitespace each token ends on covers both without a special case.
  function blankBreaks(raw) {
    var html = '';
    for (var extra = newlines(/[ \t\n]*$/.exec(raw)[0]) - 2; extra > 0; extra -= 1) {
      html += '<br>';
    }
    return html;
  }

  // Marked's tokens carry their source text but not their position, so the line a block
  // starts on is the running total of the newlines in everything before it.
  function stamp(html, line) {
    return html.replace(/^(\s*<[a-z][a-z0-9]*)/i, '$1 data-line="' + line + '"');
  }

  function toHTML(source, typed) {
    // Front matter is not markdown and never reaches the lexer; the counter starts past it so
    // every anchor below still names its own source line.
    var front = splitFront(source);
    var bodySource = front ? front.body : source;
    var body = expandTasks(markTypedSource(bodySource, front ? front.lines : 0, typed));

    var tokens = marked.lexer(body);
    var stamped = [];
    var html = front ? frontHTML(front) : '';
    var cursor = 0;
    var line = front ? 1 + front.lines : 1;

    tokens.forEach(function (token) {
      // Found back in the source rather than measured by adding up token.raw: link
      // reference definitions are lifted out of the stream entirely, and a running total
      // would swallow their lines and shift every block below them.
      var at = body.indexOf(token.raw, cursor);
      if (at < 0) { at = cursor; }
      line += newlines(body.slice(cursor, at));
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
      // gets an anchor. The breaks go on unstamped for the same reason - a gap is not a
      // block to scroll to or hang a note on.
      if (tagged !== piece) { stamped.push({ token: token, line: start }); }
      html += tagged + blankBreaks(token.raw);
    });

    totalLines = 1 + newlines(source);
    content.innerHTML = html;
    blocks = null;
    markTasks();
    tagListItems(stamped);
    mountTypedBlocks(typed);
  }

  // A thirty-item bullet list is a single token, and one anchor for thirty lines is the
  // largest remaining source of drift, so its items get their own. Matching is by document
  // order against the tokens that actually produced an anchor, which stays correct even
  // when a raw-HTML token emits several top-level elements.
  function tagListItems(stamped) {
    // The front matter block carries an anchor but came from no token, so it would put every
    // element one position out of step with `stamped`.
    var elements = content.querySelectorAll(':scope > [data-line]:not(.md-front)');

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

  // How much blank paper is left under the last block, as a fraction of the window. A page
  // shorter than the window is padded out to about a windowful, so the last paragraph does
  // not sit on the bottom edge; past that the tail shrinks to a hand's width, because half a
  // viewport of nothing at the end of a long document reads as a bug rather than as room.
  var TAIL_MIN = 0.12;
  var TAIL_MAX = 0.45;

  function fitTail() {
    var view = document.documentElement.clientHeight;
    if (!view) { return; }
    // The paper without its current tail - measured rather than remembered, so the CSS
    // default and every later fit are read the same way.
    var tail = parseFloat(window.getComputedStyle(content).paddingBottom) || 0;
    var paper = content.scrollHeight - tail;
    var fitted = Math.min(view * TAIL_MAX, Math.max(view * TAIL_MIN, view - paper));
    document.documentElement.style.setProperty('--tail', Math.round(fitted) + 'px');
  }

  function invalidate() {
    // Before the anchors go: refitting the tail is itself a layout change, and every caller
    // here is one of the moments the document could have grown or shrunk.
    fitTail();
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

  window.mdRender = function (source, typed, completed) {
    var scroller = document.scrollingElement;
    var previousTop = scroller.scrollTop;
    typed = typed || [];

    marked.setOptions({ gfm: true, breaks: false, pedantic: false });
    toHTML(source, typed);
    celebrateTasks(completed);

    // After toHTML, so the anchors are already stamped and nothing here can move them.
    markAlerts();
    assignSlugs();
    rewriteLocalImages();
    highlight();
    invalidate();
    // innerHTML threw both of these away with the old nodes.
    applyNotes();
    markTarget();

    // Initial srcdoc compilation connects Fez elements on a frame. Put source anchors and
    // note state back on the replacement roots after that layout-changing pass completes.
    requestAnimationFrame(function () {
      restoreTypedLines();
      blocks = null;
      applyNotes();
      markTarget();
      invalidate();
    });

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

  // The document's folder, so a link written as ./doc/API.md resolves against the file
  // the page is showing. Swapped in place when another file is rendered into this page.
  window.mdSetBase = function (url) {
    var base = document.getElementById('base');
    if (!base) {
      base = document.createElement('base');
      base.id = 'base';
      document.head.appendChild(base);
    }
    base.href = url;
  };

  // MARK: page -> app

  // Same-document anchors are handled here; every other link goes to the app, already
  // absolute, and the page itself never navigates away from the document it is rendering.
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest ? event.target.closest('a') : null;
    if (!anchor) { return; }
    var href = anchor.getAttribute('href') || '';
    if (!href) { return; }
    event.preventDefault();
    if (href.charAt(0) === '#') {
      window.mdScrollToAnchor(href.slice(1));
    } else {
      post({ kind: 'link', href: anchor.href });
    }
  });

  // Notes anchor to a source line, so the native context menu needs to
  // know which block was right-clicked before it is built.
  content.addEventListener('contextmenu', function (event) {
    var node = event.target.closest ? event.target.closest('[data-line]') : null;
    // The pane draws the menu itself, at the click - so the page's own menu stays shut.
    event.preventDefault();
    post({ kind: 'context', line: node ? Number(node.getAttribute('data-line')) : 1, x: event.clientX, y: event.clientY });
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
