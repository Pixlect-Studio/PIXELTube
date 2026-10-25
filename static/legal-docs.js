(function () {
  'use strict';

  function appendInline(parent, text) {
    const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text))) {
      parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      if (match[1] !== undefined || match[2] !== undefined) {
        const element = document.createElement(match[1] !== undefined ? 'strong' : 'em');
        element.textContent = match[1] ?? match[2];
        parent.appendChild(element);
      } else {
        const link = document.createElement('a');
        const url = match[4];
        let parsedUrl;
        try {
          parsedUrl = new URL(url, document.baseURI);
        } catch (error) {
          parent.appendChild(document.createTextNode(match[3]));
          cursor = pattern.lastIndex;
          continue;
        }
        if (!['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
          parent.appendChild(document.createTextNode(match[3]));
          cursor = pattern.lastIndex;
          continue;
        }
        link.href = parsedUrl.href;
        link.textContent = match[3];
        if (parsedUrl.origin !== location.origin) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        parent.appendChild(link);
      }
      cursor = pattern.lastIndex;
    }
    parent.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function appendParagraph(parent, lines) {
    if (!lines.length) return;
    const paragraph = document.createElement('p');
    appendInline(paragraph, lines.join(' '));
    parent.appendChild(paragraph);
  }

  function renderMarkdown(container, markdown) {
    const fragment = document.createDocumentFragment();
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const listStack = [];
    let paragraphLines = [];

    function flushParagraph(clearLists = true) {
      appendParagraph(fragment, paragraphLines);
      paragraphLines = [];
      if (clearLists) listStack.length = 0;
    }

    function appendListItem(match) {
      flushParagraph(false);

      const indent = match[1].length;
      const tag = /^\d/.test(match[2]) ? 'ol' : 'ul';
      while (listStack.length && indent < listStack[listStack.length - 1].indent) {
        listStack.pop();
      }

      let current = listStack[listStack.length - 1];
      if (current && indent === current.indent && tag !== current.tag) {
        listStack.pop();
        current = listStack[listStack.length - 1];
      }

      if (!current || indent > current.indent) {
        const parent = current ? current.item : fragment;
        const list = document.createElement(tag);
        parent.appendChild(list);
        listStack.push({ indent, tag, list, item: null });
        current = listStack[listStack.length - 1];
      }

      const item = document.createElement('li');
      appendInline(item, match[3]);
      current.list.appendChild(item);
      current.item = item;
    }

    for (const line of lines) {
      if (!line.trim()) {
        flushParagraph(false);
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        const element = document.createElement(`h${heading[1].length}`);
        appendInline(element, heading[2].trim());
        fragment.appendChild(element);
        continue;
      }

      const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (listItem) {
        appendListItem(listItem);
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        fragment.appendChild(document.createElement('hr'));
        continue;
      }

      if (listStack.length) listStack.length = 0;
      paragraphLines.push(line.trim());
    }

    appendParagraph(fragment, paragraphLines);
    container.replaceChildren(fragment);
  }

  async function loadDocument(container) {
    const filename = container.dataset.legalMarkdown;
    const sourceUrl = new URL(encodeURIComponent(filename), document.baseURI);
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      renderMarkdown(container, await response.text());
    } catch (error) {
      console.error(`Could not load legal document "${filename}":`, error);
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = `Could not load this document. `;
      const link = document.createElement('a');
      link.href = sourceUrl.href;
      link.textContent = 'Open the Markdown source';
      message.appendChild(link);
      container.replaceChildren(message);
    }
  }

  document.querySelectorAll('[data-legal-markdown]').forEach(loadDocument);
})();
