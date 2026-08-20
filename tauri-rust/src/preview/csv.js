// The csv page's script. A real file rather than a Swift heredoc, for the same reason
// preview.js is one. Inlined into the page by CSVPageBuilder.
//
// Swift -> page: csvRender, csvSetTheme, csvSetFontSize, csvScrollTo.
// Page -> Swift: window.webkit.messageHandlers.mdboss.postMessage({kind, ...}).
//
// Parsing happens in Swift (CSVTable), so what arrives here is already rows of strings. The
// page only draws them - and it draws them with textContent rather than innerHTML, so a cell
// containing markup is a cell containing markup and never part of this page.

(function () {
  'use strict';

  var sheet = document.getElementById('sheet');

  // How long after a programmatic scroll the resulting events are ignored. One assignment to
  // scrollTop settles over several frames, and recording those would overwrite the place we
  // were just restoring to.
  var SETTLE = 120;
  var suppressUntil = 0;
  var scrollFrame = null;

  function post(message) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mdboss) {
      window.webkit.messageHandlers.mdboss.postMessage(message);
    }
  }

  // A page error would otherwise be invisible - the table would just not appear.
  window.addEventListener('error', function (event) {
    post({ kind: 'error', message: String(event.message || event.type) });
  });

  function cell(tag, text) {
    var node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function row(values, tag) {
    var tr = document.createElement('tr');
    for (var i = 0; i < values.length; i += 1) {
      tr.appendChild(cell(tag, values[i]));
    }
    return tr;
  }

  function notice(text) {
    var node = document.createElement('p');
    node.className = 'notice';
    node.textContent = text;
    return node;
  }

  // MARK: Swift -> page

  // data = { header: [...], rows: [[...]], total: n, delimiter: "," }
  window.csvRender = function (data) {
    var scroller = document.scrollingElement;
    var previousTop = scroller.scrollTop;
    var previousLeft = scroller.scrollLeft;

    sheet.textContent = '';

    // No table at all is the parse still running, which is a blank page - "this file has no
    // rows" is a thing the file can be and must not be claimed before anyone has looked.
    if (!data) { return; }

    if (!data.header || !data.header.length) {
      sheet.appendChild(notice('Nothing to show - this file has no rows.'));
      return;
    }

    if (data.rows.length < data.total) {
      sheet.appendChild(notice(
        'Showing the first ' + data.rows.length.toLocaleString() +
        ' of ' + data.total.toLocaleString() + ' rows.'
      ));
    }

    // Built into a fragment and attached once: a row at a time would lay the table out again
    // for every one of them.
    var table = document.createElement('table');
    var head = document.createElement('thead');
    head.appendChild(row(data.header, 'th'));
    table.appendChild(head);

    var body = document.createElement('tbody');
    var chunk = document.createDocumentFragment();
    for (var i = 0; i < data.rows.length; i += 1) {
      chunk.appendChild(row(data.rows[i], 'td'));
    }
    body.appendChild(chunk);
    table.appendChild(body);
    sheet.appendChild(table);

    // Re-rendering after an edit must not throw away the reader's place, sideways included.
    scroller.scrollTop = previousTop;
    scroller.scrollLeft = previousLeft;
  };

  window.csvSetTheme = function (css) {
    document.getElementById('theme').textContent = css;
  };

  window.csvSetFontSize = function (px) {
    document.documentElement.style.setProperty('--body-size', px + 'px');
  };

  // Where the reader was when they last left this file. Clamped here rather than in Swift,
  // since only the page knows how far the table actually reaches.
  window.csvScrollTo = function (x, y) {
    var scroller = document.scrollingElement;
    suppressUntil = Date.now() + SETTLE;
    scroller.scrollTop = Math.min(Math.max(0, y), Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    scroller.scrollLeft = Math.min(Math.max(0, x), Math.max(0, scroller.scrollWidth - scroller.clientWidth));
  };

  // MARK: dragging the sheet around

  // A wide table is mostly off screen, and reaching for a horizontal scrollbar to see column
  // twelve is the wrong gesture - so the sheet is grabbable and the drag pans it, the way a
  // map or a PDF works.
  //
  // A single-click drag pans and therefore does not select; a double or triple click still
  // selects a word or a cell, which is what keeps copying out of the table possible. That is
  // the whole reason for the `detail` check - `preventDefault` on mousedown suppresses the
  // selection the browser would otherwise start, including the one a double click makes.
  var pan = null;

  document.addEventListener('mousedown', function (event) {
    if (event.button !== 0 || event.detail !== 1) { return; }

    var scroller = document.scrollingElement;
    pan = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop
    };
    document.body.classList.add('panning');
    event.preventDefault();
  });

  document.addEventListener('mousemove', function (event) {
    if (!pan) { return; }

    var scroller = document.scrollingElement;
    // Measured from where the drag started rather than accumulated per event, so the sheet
    // tracks the cursor exactly instead of drifting - the same reasoning as `DividerHost`.
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
  });

  // On window, not on the page: a drag that ends outside the web view still has to let go.
  window.addEventListener('mouseup', function () {
    pan = null;
    document.body.classList.remove('panning');
  });

  // MARK: page -> Swift

  document.addEventListener('scroll', function () {
    if (Date.now() < suppressUntil) { return; }
    if (scrollFrame) { return; }
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = null;
      var scroller = document.scrollingElement;
      post({ kind: 'scroll', x: scroller.scrollLeft, y: scroller.scrollTop });
    });
  }, { passive: true });

  post({ kind: 'ready' });
})();
