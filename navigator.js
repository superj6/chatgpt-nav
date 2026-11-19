(() => {
  "use strict";

  const contentSelector = '[data-message-author-role="user"], [data-user-message-bubble="true"]';
  const replyContentSelector = '[data-message-author-role="assistant"]';
  const promptSelector = `${contentSelector}, [data-turn="user"], [data-conversation-role="user"], ` +
    '[data-message-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"]';
  const replySelector = `${replyContentSelector}, [data-turn="assistant"], [data-conversation-role="assistant"], ` +
    '[data-message-role="assistant"], [data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
  const messageSelector = `${promptSelector}, ${replySelector}`;
  const turnAttributes = ["data-message-id", "data-content-search-unit-key", "data-chatgpt-search-unit-key",
    "data-turn-key", "data-turn-id", "data-virtual-list-item-key"];
  const turnWrapper = '[data-testid^="conversation-turn-"], [data-turn-key], [data-turn-id], [data-virtual-list-item-key]';
  const visualSelector = 'img, canvas, iframe, svg[role="img"], svg[aria-label], [data-testid*="chart" i]';
  const screenReaderOnly = ".sr-only, .visually-hidden, .screen-reader-only";
  const views = {
    conversation: { name: "Conversation", placeholder: "Search the conversation" },
    outline: { name: "Outline", selector: 'h1, h2, h3, h4, h5, h6, [role="heading"]', noun: "heading", placeholder: "Search headings" },
    code: { name: "Code blocks", selector: "pre", noun: "code block", placeholder: "Search code blocks" },
    tables: { name: "Tables", selector: 'table, [role="table"]', noun: "table", placeholder: "Search tables" },
    visuals: { name: "Charts & images", selector: visualSelector, noun: "visual", placeholder: "Search charts and images" },
    lists: { name: "Lists", selector: "ul, ol", noun: "list", placeholder: "Search lists" },
    quotes: { name: "Quotes", selector: "blockquote", noun: "quote", placeholder: "Search quotes" },
  };
  const detailModes = Object.keys(views).filter((mode) => views[mode].selector);
  const host = document.createElement("div");
  host.id = "chatgpt-conversation-navigator";
  if (document.getElementById(host.id)) return;

  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = browser.runtime.getURL("navigator.css");

  function element(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }

  const launcher = element("button", "Navigate chat", {
    class: "launcher", type: "button", "aria-expanded": "false", "aria-controls": "prompt-panel",
  });
  const panel = element("section", "", { class: "panel", id: "prompt-panel", "aria-label": "Conversation navigator" });
  const controls = element("div", "", { class: "controls" });
  const previous = element("button", "Previous", { type: "button", "aria-label": "Previous prompt" });
  const next = element("button", "Next", { type: "button", "aria-label": "Next prompt" });
  const latest = element("button", "Latest", { type: "button", "aria-label": "Latest prompt" });
  const scanButton = element("button", "Scan full chat", { type: "button" });
  const filters = element("div", "", { class: "filters" });
  const view = element("select", "", { "aria-label": "Show" });
  for (const [value, { name }] of Object.entries(views)) view.append(element("option", name, { value }));
  const search = element("input", "", {
    type: "search", placeholder: views.conversation.placeholder,
    "aria-label": views.conversation.placeholder, autocomplete: "off",
  });
  const status = element("p", "", { class: "status", role: "status" });
  const detailControls = element("div", "", { class: "detail-controls" });
  const foldAll = element("button", "Collapse all", { type: "button" });
  const topLevelOnly = element("input", "", { type: "checkbox" });
  const depth = element("label", "");
  depth.append(topLevelOnly, document.createTextNode("Top-level only"));
  detailControls.append(foldAll, depth);
  const list = element("ul", "", { class: "list", "aria-label": "Jump targets", role: "list" });

  controls.append(previous, next, latest, scanButton);
  filters.append(view, search);
  panel.append(controls, filters, detailControls, status, list);
  shadow.append(stylesheet, launcher, panel);
  host.hidden = true;
  panel.hidden = true;
  document.body.append(host);

  let prompts = [];
  let mounted = new Map();
  let detailSnapshots = new WeakMap();
  const collapsedGroups = new Map(detailModes.map((mode) => [mode, new Set()]));
  let chatScroller;
  let historyIndex;
  let scan;
  let jumpRequest = 0;
  let notice = "";
  let pathname = location.pathname;
  let lastJump;
  let currentRow;
  let selectedResult;
  let rows = new Map();
  let targets = new Map();
  let displayed = [];
  let refreshFrame = 0;
  let scrollFrame = 0;
  let groupControlsFrame = 0;

  function scrollContainer(node) {
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (/^(auto|scroll|overlay)$/.test(overflow) && parent.scrollHeight > parent.clientHeight) return parent;
    }
    return document.scrollingElement;
  }

  function scrollAnchor(container) {
    if (container === document.scrollingElement) return 84;
    return Math.max(84, container.getBoundingClientRect().top + 16);
  }

  function viewportTop(container) {
    return container === document.scrollingElement ? 0 : container.getBoundingClientRect().top;
  }

  function maxScroll(container) {
    return Math.max(0, container.scrollHeight - container.clientHeight);
  }

  function navigationTargets() {
    const entries = Array.from(targets.values());
    const container = chatScroller;
    if (!container || !entries.length) return {};
    if (lastJump?.container === container && Math.abs(container.scrollTop - lastJump.top) < 1) {
      const index = entries.findIndex(({ key }) => key === lastJump.key);
      if (index !== -1) return { current: entries[index], before: entries[index - 1], after: entries[index + 1] };
    }
    lastJump = undefined;

    const anchor = scrollAnchor(container);
    const origin = container.scrollTop - viewportTop(container);
    let before, after, current;
    for (const entry of entries) {
      const node = entry.node ?? mounted.get(entry.key)?.node;
      const position = node?.isConnected ? node.getBoundingClientRect().top : entry.top - origin;
      if (position < anchor - 8) before = entry;
      else if (position <= anchor + 8) current ??= entry;
      else if (position > anchor + 8) after ??= entry;
    }
    const active = current ?? (isPromptList() ? before ?? entries[0] : undefined);
    return { before: container.scrollTop > 1 ? before : undefined, after, current: active };
  }

  function updateNavigation() {
    const browsingPrompts = isPromptList();
    const { before, after, current } = navigationTargets();
    previous.disabled = !!scan || !before;
    next.disabled = !!scan || !after;
    latest.disabled = !!scan || !rows.size;
    previous.setAttribute("aria-label", browsingPrompts ? "Previous prompt" : "Previous item");
    next.setAttribute("aria-label", browsingPrompts ? "Next prompt" : "Next item");
    latest.setAttribute("aria-label", browsingPrompts ? "Latest prompt" : "Last item");
    const lastLabel = browsingPrompts ? "Latest" : "Last";
    if (latest.textContent !== lastLabel) latest.textContent = lastLabel;

    const activeRow = rows.get(current?.key);
    if (activeRow === currentRow) return;
    currentRow?.removeAttribute("aria-current");
    activeRow?.setAttribute("aria-current", "true");
    currentRow = activeRow;
  }

  function jumpTo(node, key) {
    const container = scrollContainer(node.closest(messageSelector) ?? node);
    const top = node.getBoundingClientRect().top - scrollAnchor(container);
    container.scrollBy({ top, behavior: "instant" });
    lastJump = { key, container, top: container.scrollTop };
    selectedResult = key;
    updateNavigation();
    const row = rows.get(key);
    const group = row?.closest("details");
    if (group && !group.open) group.open = true;
    row?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  function normalize(text) {
    return text?.replace(/\s+/g, " ").trim() ?? "";
  }

  function messageText(node, label) {
    const speaker = `${label} said`;
    const headings = Array.from(node.querySelectorAll(screenReaderOnly))
      .filter((heading) => {
        const text = normalize(heading.textContent);
        return text === speaker || text === `${speaker}:`;
      });
    if (!headings.length) return normalize(node.innerText) || normalize(node.textContent);

    function read(part) {
      if (headings.includes(part)) return "";
      if (headings.some((heading) => part.contains(heading))) {
        return Array.from(part.childNodes, read).join(" ");
      }
      return part.innerText || part.textContent;
    }

    return normalize(read(node));
  }

  function isPromptList() {
    return view.value === "conversation" && !search.value.trim();
  }

  function visible(node) {
    return !node.closest('[hidden], [aria-hidden="true"]');
  }

  function messageNodes(selector) {
    const nodes = new Map();
    for (const match of document.querySelectorAll(selector)) {
      const reply = match.matches(replySelector);
      const content = reply ? replyContentSelector : contentSelector;
      const node = match.querySelector(content) ?? match.closest(content) ?? match;
      const roleSelector = reply ? replySelector : promptSelector;
      if (!visible(node)) continue;
      if (node.matches(content) && node.querySelector(content)) continue;
      if (!node.matches(content) && (node.querySelector(roleSelector) || node.parentElement?.closest(content))) continue;
      nodes.set(node, reply ? "ChatGPT" : "You");
    }
    return nodes;
  }

  function readMessages(selector) {
    const nodes = messageNodes(selector);
    const first = nodes.keys().next().value;
    if (first && (!chatScroller?.isConnected || !chatScroller.contains(first) ||
        (chatScroller === document.scrollingElement && !historyIndex && !scan))) {
      chatScroller = scrollContainer(first);
    }
    const messages = new Map();
    if (!chatScroller) return messages;

    const measure = historyIndex || scan?.gathering;
    const origin = measure ? chatScroller.scrollTop - viewportTop(chatScroller) : 0;
    for (const [node, label] of nodes) {
      const text = messageText(node, label);
      if (!text && !node.querySelector(`video, audio, [data-testid*="attachment" i], ${visualSelector}`)) continue;
      let top;
      if (measure) {
        const rect = node.getBoundingClientRect();
        const wrapper = node.closest(turnWrapper);
        top = (rect.height || !wrapper ? rect.top : wrapper.getBoundingClientRect().top) + origin;
      }
      let key = node;
      for (const attribute of turnAttributes) {
        const value = node.closest(`[${attribute}]`)?.getAttribute(attribute);
        if (!value) continue;
        key = `${label}:${attribute}:${value}`;
        break;
      }
      if (key === node) {
        const turn = node.closest('[data-testid^="conversation-turn-"]')?.dataset.testid;
        if (turn) key = `${label}:${turn}`;
        else if (measure) key = `${label}:${Math.round(top)}`;
      }
      messages.set(key, { key, node, label, text: text || "Attachment", top });
    }
    return messages;
  }

  function indexMessages(index) {
    for (const message of mounted.values()) {
      const { key, node, label, text, top } = message;
      let snapshot = detailSnapshots.get(node);
      if (!snapshot || snapshot.key !== key || snapshot.text !== text || snapshot.top !== top) {
        const details = {};
        for (const mode of detailModes) {
          details[mode] = readItems(message, mode).map(({ node, ...item }) => item);
        }
        snapshot = { key, label, text, top, details };
        detailSnapshots.set(node, snapshot);
      }
      index.set(key, snapshot);
    }
  }

  function conversationEntries() {
    if (!historyIndex) return Array.from(mounted.values());
    return Array.from(historyIndex.values()).sort((a, b) => a.top - b.top);
  }

  function describeItem(node, mode) {
    if (mode === "outline") {
      const level = Number(node.getAttribute("aria-level") ?? node.localName.slice(1));
      const headingLevel = Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
      return { label: `H${headingLevel}`, text: normalize(node.innerText ?? node.textContent), level: headingLevel };
    }
    if (mode === "code") {
      const code = node.querySelector("code") ?? node;
      const language = Array.from(code.classList).find((name) => name.startsWith("language-"))?.slice(9);
      return { label: language ? `${language} code` : "Code block", text: normalize(code.innerText) };
    }
    if (mode === "tables") {
      return { label: normalize(node.querySelector("caption")?.innerText) || "Table", text: normalize(node.innerText) };
    }
    if (mode === "lists") {
      const label = node.localName === "ol" ? "Numbered list" : "Bulleted list";
      return { label, text: normalize(node.innerText) };
    }
    if (mode === "quotes") return { label: "Quote", text: normalize(node.innerText) };
    const tag = node.localName;
    const label = tag === "img" ? "Image" : tag === "iframe" ? "Embed" : "Chart";
    const caption = normalize(node.closest("figure")?.querySelector("figcaption")?.innerText);
    const description = normalize(node.getAttribute("alt") || node.getAttribute("aria-label") ||
      node.getAttribute("title") || node.querySelector("title")?.textContent);
    const text = Array.from(new Set([caption, description])).filter(Boolean).join(" · ");
    return { label, text };
  }

  function readItems(message, mode) {
    const { selector } = views[mode];
    const items = [];
    const root = message.node;
    const measure = Number.isFinite(message.top);
    const origin = measure ? chatScroller.scrollTop - viewportTop(chatScroller) : 0;
    for (const node of root.querySelectorAll(selector)) {
      const parentItem = node.parentElement.closest(selector);
      if (!visible(node) || node.closest(screenReaderOnly) || (parentItem && root.contains(parentItem))) continue;
      if (node.localName === "img" && node.naturalWidth > 0 && node.naturalWidth < 40 && node.naturalHeight < 40) continue;
      const description = describeItem(node, mode);
      if (mode === "outline" && !description.text) continue;
      const key = typeof message.key === "string" ? `${message.key}\u001f${mode}\u001f${items.length}` : node;
      const rect = measure ? node.getBoundingClientRect() : undefined;
      const top = rect?.height ? rect.top + origin : message.top;
      items.push({ key, node, mode, messageKey: message.key, top, ...description });
    }
    return items;
  }

  function collectItems(mode) {
    const messages = historyIndex ? conversationEntries() : Array.from(readMessages(messageSelector).values());
    if (mode === "conversation") return messages;

    const results = [];
    let topic = "";
    for (const message of messages) {
      if (message.label === "You") topic = message.text;
      const context = topic || message.text;
      const shortContext = context.length > 75 ? `${context.slice(0, 72)}…` : context;
      const group = { key: message.key, title: `${message.label} · ${shortContext}` };
      const items = message.details ? message.details[mode] : readItems(message, mode);
      const topLevel = mode === "outline" ? Math.min(...items.map(({ level }) => level)) : undefined;
      for (const item of items) {
        if (mode === "outline" && topLevelOnly.checked && item.level !== topLevel) continue;
        results.push({ ...item, group, indent: item.level ? item.level - topLevel : 0 });
      }
    }
    return results;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function targetNode(entry, messages) {
    if (entry.node?.isConnected) return entry.node;
    const message = messages.get(entry.messageKey ?? entry.key);
    if (!message?.node.isConnected) return undefined;
    if (entry.mode) {
      const matches = readItems(message, entry.mode).filter(({ label, text }) => label === entry.label && text === entry.text);
      const match = matches.find(({ key }) => key === entry.key);
      return match?.node ?? (matches.length === 1 ? matches[0].node : undefined);
    }
    return message.node;
  }

  async function findIndexedTarget(entry, container, request) {
    const step = Math.max(1, container.clientHeight * 0.7);
    const top = entry.top - scrollAnchor(container) + viewportTop(container);
    notice = "Finding item…";
    renderList();
    for (const offset of [0, -step, step]) {
      container.scrollTo({ top: top + offset, behavior: "instant" });
      for (let attempt = 0; attempt < 4; attempt++) {
        await delay(80);
        if (request !== jumpRequest || pathname !== location.pathname || !container.isConnected) return;
        const node = targetNode(entry, readMessages(messageSelector));
        if (!node) continue;
        notice = "";
        refreshPrompts();
        jumpTo(node, entry.key);
        return;
      }
    }
    notice = "Item unavailable. Try scanning again.";
    renderList();
  }

  function chooseResult(entry) {
    if (!entry || scan) return;
    const request = ++jumpRequest;
    const node = targetNode(entry, mounted);
    if (node?.isConnected) {
      if (notice) {
        notice = "";
        renderList();
      }
      jumpTo(node, entry.key);
    } else if (chatScroller?.isConnected && Number.isFinite(entry.top)) {
      void findIndexedTarget(entry, chatScroller, request);
    }
  }

  function stepResult(direction) {
    const keys = Array.from(rows.keys());
    if (!keys.length) return;
    const index = keys.indexOf(selectedResult);
    const position = index === -1 ? (direction === 1 ? 0 : keys.length - 1) :
      (index + direction + keys.length) % keys.length;
    chooseResult(targets.get(keys[position]));
  }

  function updateGroupControls() {
    const groups = Array.from(list.querySelectorAll("details"));
    const hasGroups = groups.length > 0;
    depth.hidden = view.value !== "outline";
    detailControls.hidden = !hasGroups && depth.hidden;
    foldAll.hidden = !hasGroups;
    const label = groups.some((group) => group.open) ? "Collapse all" : "Expand all";
    if (foldAll.textContent !== label) foldAll.textContent = label;
  }

  function renderList() {
    const query = normalize(search.value).toLowerCase();
    const browsingPrompts = isPromptList();
    const entries = browsingPrompts ? prompts : collectItems(view.value);
    const noun = browsingPrompts ? "prompt" : views[view.value].noun ?? "message";
    const results = [];
    entries.forEach((entry, index) => {
      const { key, label, text } = entry;
      const labelMatches = label?.toLowerCase().includes(query);
      const offset = text.toLowerCase().indexOf(query);
      if (query && offset < 0 && !labelMatches) return;
      const start = Math.max(0, offset - 48);
      const end = start + 150;
      const excerpt = `${start ? "…" : ""}${text.slice(start, end)}${text.length > end ? "…" : ""}`;
      results.push({
        key, entry, label: browsingPrompts ? String(index + 1) : label, excerpt, browsingPrompts,
        group: entry.group, indent: entry.indent,
      });
    });

    const total = entries.length;
    const summary = notice || (query ? `${results.length} of ${total} ${noun}${total === 1 ? "" : "s"}` :
      `${total} ${noun}${total === 1 ? "" : "s"}`);
    if (status.textContent !== summary) status.textContent = summary;
    targets = new Map(results.map(({ key, entry }) => [key, entry]));
    if (results.length === displayed.length && results.every(({ key, label, excerpt, group, indent, browsingPrompts }, index) => (
      key === displayed[index].key && label === displayed[index].label && excerpt === displayed[index].excerpt &&
      group?.title === displayed[index].group?.title && indent === displayed[index].indent &&
      browsingPrompts === displayed[index].browsingPrompts
    ))) {
      updateGroupControls();
      updateNavigation();
      return;
    }
    displayed = results.map(({ entry, ...result }) => result);
    list.classList.toggle("details", !browsingPrompts);
    list.classList.toggle("outline", view.value === "outline");
    const focusedRow = shadow.activeElement;
    const items = document.createDocumentFragment();
    let nextFocus;
    const visibleRows = new Map();
    const groups = new Map();
    const collapsed = collapsedGroups.get(view.value);

    for (const { key, label, excerpt, group, indent } of results) {
      const button = element("button", "", { type: "button" });
      if (indent) button.classList.add(`indent-${indent}`);
      button.append(element("span", label, { class: browsingPrompts ? "number" : "label" }));
      if (excerpt) button.append(element("span", excerpt));
      button.addEventListener("click", () => chooseResult(targets.get(key)));
      const item = element("li");
      item.append(button);
      let groupList = groups.get(group?.key);
      if (group && !groupList) {
        const disclosure = element("details", "", { class: "group" });
        disclosure.open = Boolean(query) || !collapsed.has(group.key);
        disclosure.addEventListener("toggle", () => {
          if (!disclosure.isConnected) return;
          if (!query) {
            if (disclosure.open) collapsed.delete(group.key);
            else collapsed.add(group.key);
          }
          if (!groupControlsFrame) {
            groupControlsFrame = requestAnimationFrame(() => {
              groupControlsFrame = 0;
              updateGroupControls();
            });
          }
        });
        groupList = element("ul", "", { class: "group-items", role: "list" });
        disclosure.append(element("summary", group.title), groupList);
        const wrapper = element("li");
        wrapper.append(disclosure);
        items.append(wrapper);
        groups.set(group.key, groupList);
      }
      (groupList ?? items).append(item);
      visibleRows.set(key, button);
      if (focusedRow && focusedRow === rows.get(key)) nextFocus = button;
    }
    rows = visibleRows;
    list.replaceChildren(items);
    updateGroupControls();
    updateNavigation();
    nextFocus?.focus({ preventScroll: true });
  }

  function setOpen(open) {
    if (!open) {
      if (scan) scan.stopped = true;
      jumpRequest++;
      notice = "";
    }
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      renderList();
      search.focus({ preventScroll: true });
    }
  }

  function setScanBusy(busy) {
    scanButton.textContent = busy ? "Stop scan" : "Scan full chat";
    search.disabled = busy;
    view.disabled = busy;
    topLevelOnly.disabled = busy;
    foldAll.disabled = busy;
    list.inert = busy;
    updateNavigation();
  }

  async function scanConversation() {
    if (scan) {
      scan.stopped = true;
      return;
    }
    const container = chatScroller;
    if (!container?.isConnected) return;
    const path = location.pathname;
    const startTop = container.scrollTop;
    const startBottom = maxScroll(container);
    const state = { index: new Map(), restore: true, gathering: false, stopped: false };
    const canScan = () => scan === state && !state.stopped && path === location.pathname && container.isConnected;
    jumpRequest++;
    notice = "";
    scan = state;
    setScanBusy(true);
    status.textContent = "Loading older messages…";

    try {
      let height = container.scrollHeight;
      let quietSince = performance.now();
      const deadline = quietSince + 10000;
      // Older messages may be prepended asynchronously when the top is reached.
      while (canScan() && performance.now() - quietSince < 850 && performance.now() < deadline) {
        container.scrollTo({ top: 0, behavior: "instant" });
        await delay(100);
        if (container.scrollHeight !== height || container.scrollTop > 1) {
          height = container.scrollHeight;
          quietSince = performance.now();
        }
      }
      if (!canScan()) return;
      state.gathering = true;
      refreshPrompts();

      // Overlap viewports so short prompts between long replies are picked up.
      while (canScan()) {
        const top = container.scrollTop;
        const end = maxScroll(container);
        if (end - top <= 1) {
          await delay(180);
          if (!canScan() || maxScroll(container) <= end + 1) break;
        } else {
          const step = Math.max(1, Math.floor(container.clientHeight * 0.75));
          container.scrollTo({ top: top + step, behavior: "instant" });
          await delay(70);
        }
        if (!canScan()) break;
        refreshPrompts();
        if (container.scrollTop <= top && maxScroll(container) <= end) break;
      }
      if (canScan()) refreshPrompts();
    } finally {
      if (scan === state) {
        scan = undefined;
        if (path === location.pathname && container.isConnected) {
          if (state.index.size && (!state.stopped || !historyIndex)) historyIndex = state.index;
          if (state.restore) container.scrollTo({ top: startTop + maxScroll(container) - startBottom, behavior: "instant" });
        }
        setScanBusy(false);
        refreshPrompts();
      }
    }
  }

  function refreshPrompts() {
    refreshFrame = 0;
    if (pathname !== location.pathname) {
      pathname = location.pathname;
      scan = undefined;
      historyIndex = undefined;
      chatScroller = undefined;
      mounted.clear();
      detailSnapshots = new WeakMap();
      for (const groups of collapsedGroups.values()) groups.clear();
      lastJump = undefined;
      selectedResult = undefined;
      jumpRequest++;
      notice = "";
      search.value = "";
      setScanBusy(false);
    }

    mounted = readMessages(scan?.gathering || historyIndex ? messageSelector : promptSelector);
    if (!mounted.size && !scan && !historyIndex) mounted = readMessages(replySelector);
    if (scan) {
      if (scan.gathering) {
        indexMessages(scan.index);
        const count = Array.from(scan.index.values()).filter(({ label }) => label === "You").length;
        const progress = `Scanning… ${count} ${count === 1 ? "prompt" : "prompts"} found`;
        if (status.textContent !== progress) status.textContent = progress;
      }
      return;
    }

    if (historyIndex) indexMessages(historyIndex);
    prompts = conversationEntries().filter(({ label }) => label === "You");
    host.hidden = !prompts.length && !mounted.size;
    if (host.hidden) setOpen(false);
    if (!panel.hidden) renderList();
  }

  function scheduleRefresh() {
    if (!refreshFrame) refreshFrame = requestAnimationFrame(refreshPrompts);
  }

  function touchesMessage(record) {
    const selector = scan || historyIndex || !prompts.length || (!panel.hidden && !isPromptList()) ?
      messageSelector : promptSelector;
    const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (host.contains(target)) return false;
    if (target?.closest(selector)) return true;
    if (record.type === "attributes") {
      if (["hidden", "aria-hidden", "data-testid", "aria-level", "role", "alt", "title", "aria-label"].includes(record.attributeName)) {
        return target?.querySelector(selector);
      }
      return true;
    }
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE && (
      node.matches(selector) || node.querySelector(selector)
    ));
  }

  launcher.addEventListener("click", () => setOpen(panel.hidden));
  scanButton.addEventListener("click", () => void scanConversation());
  previous.addEventListener("click", () => chooseResult(navigationTargets().before));
  next.addEventListener("click", () => chooseResult(navigationTargets().after));
  latest.addEventListener("click", () => chooseResult(Array.from(targets.values()).at(-1)));
  foldAll.addEventListener("click", () => {
    const groups = Array.from(list.querySelectorAll("details"));
    const expand = groups.every((group) => !group.open);
    for (const group of groups) group.open = expand;
    updateGroupControls();
  });
  topLevelOnly.addEventListener("change", () => {
    jumpRequest++;
    notice = "";
    renderList();
  });
  search.addEventListener("input", () => {
    jumpRequest++;
    notice = "";
    selectedResult = undefined;
    renderList();
  });
  view.addEventListener("change", () => {
    jumpRequest++;
    notice = "";
    search.value = "";
    const { placeholder } = views[view.value];
    search.placeholder = placeholder;
    search.setAttribute("aria-label", placeholder);
    selectedResult = undefined;
    renderList();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    stepResult(event.shiftKey ? -1 : 1);
  });
  shadow.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    launcher.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (host.hidden || event.repeat || event.isComposing || !event.altKey || !event.shiftKey ||
        event.ctrlKey || event.metaKey || event.code !== "KeyJ") return;
    event.preventDefault();
    setOpen(panel.hidden);
    if (panel.hidden) launcher.focus({ preventScroll: true });
  });
  document.addEventListener("scroll", (event) => {
    if (scan || panel.hidden || event.composedPath().includes(host) || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!panel.hidden) updateNavigation();
    });
  }, { capture: true, passive: true });
  for (const type of ["wheel", "touchstart"]) {
    document.addEventListener(type, (event) => {
      if (!scan || event.composedPath().includes(host)) return;
      scan.stopped = true;
      scan.restore = false;
    }, { capture: true, passive: true });
  }
  window.addEventListener("popstate", scheduleRefresh);

  const observer = new MutationObserver((records) => {
    if (pathname !== location.pathname || records.some(touchesMessage)) {
      detailSnapshots = new WeakMap();
      scheduleRefresh();
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...turnAttributes, "data-message-author-role", "data-user-message-bubble", "data-turn",
      "data-conversation-role", "data-message-role", "data-testid", "hidden", "aria-hidden", "aria-level", "role", "alt", "title", "aria-label"],
  });
  refreshPrompts();
})();
