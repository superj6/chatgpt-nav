(() => {
  "use strict";

  const contentSelector = '[data-message-author-role="user"], [data-user-message-bubble="true"]';
  const promptSelector = `${contentSelector}, [data-turn="user"], [data-content-search-unit-key$=":user"]`;
  const replyContentSelector = '[data-message-author-role="assistant"]';
  const replySelector = `${replyContentSelector}, [data-turn="assistant"], [data-content-search-unit-key$=":assistant"]`;
  const messageSelector = `${promptSelector}, ${replySelector}`;
  const visualSelector = 'img, canvas, iframe, svg[role="img"], svg[aria-label], [data-testid*="chart" i]';
  const views = {
    conversation: { name: "Conversation", placeholder: "Search the conversation" },
    code: { name: "Code blocks", selector: "pre", noun: "code block", placeholder: "Search code blocks" },
    tables: { name: "Tables", selector: 'table, [role="table"]', noun: "table", placeholder: "Search tables" },
    visuals: { name: "Charts & images", selector: visualSelector, noun: "visual", placeholder: "Search charts and images" },
  };
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
  const filters = element("div", "", { class: "filters" });
  const view = element("select", "", { "aria-label": "Show" });
  for (const [value, { name }] of Object.entries(views)) view.append(element("option", name, { value }));
  const search = element("input", "", {
    type: "search", placeholder: views.conversation.placeholder,
    "aria-label": views.conversation.placeholder, autocomplete: "off",
  });
  const status = element("p", "", { class: "status", role: "status" });
  const list = element("ul", "", { class: "list", "aria-label": "Jump targets", role: "list" });

  controls.append(previous, next, latest);
  filters.append(view, search);
  panel.append(controls, filters, status, list);
  shadow.append(stylesheet, launcher, panel);
  host.hidden = true;
  panel.hidden = true;
  document.body.append(host);

  let prompts = [];
  let pathname = location.pathname;
  let lastJump;
  let currentRow;
  let selectedResult;
  let rows = new Map();
  let displayed = [];
  let refreshFrame = 0;
  let scrollFrame = 0;

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

  function indexAtViewport() {
    if (!prompts.length) return -1;
    if (lastJump && Math.abs(lastJump.container.scrollTop - lastJump.top) < 1) {
      const index = prompts.findIndex(({ node }) => node === lastJump.node);
      if (index !== -1) return index;
    }
    lastJump = undefined;

    const container = scrollContainer(prompts[0].node);
    const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
    if (container.scrollTop > 0 && remaining <= 1) return prompts.length - 1;

    const anchor = scrollAnchor(container) + 8;
    for (let index = prompts.length - 1; index > 0; index--) {
      if (prompts[index].node.getBoundingClientRect().top <= anchor) return index;
    }
    return 0;
  }

  function updateNavigation() {
    const browsingPrompts = isPromptList();
    const currentIndex = browsingPrompts ? indexAtViewport() : -1;
    previous.disabled = browsingPrompts ? currentIndex <= 0 : !rows.size;
    next.disabled = browsingPrompts ? currentIndex < 0 || currentIndex === prompts.length - 1 : !rows.size;
    latest.disabled = browsingPrompts ? !prompts.length : !rows.size;
    previous.setAttribute("aria-label", browsingPrompts ? "Previous prompt" : "Previous item");
    next.setAttribute("aria-label", browsingPrompts ? "Next prompt" : "Next item");
    latest.setAttribute("aria-label", browsingPrompts ? "Latest prompt" : "Last item");
    const lastLabel = browsingPrompts ? "Latest" : "Last";
    if (latest.textContent !== lastLabel) latest.textContent = lastLabel;

    const activeRow = rows.get(browsingPrompts ? prompts[currentIndex]?.node : selectedResult);
    if (activeRow === currentRow) return;
    currentRow?.removeAttribute("aria-current");
    activeRow?.setAttribute("aria-current", "true");
    currentRow = activeRow;
  }

  function jumpTo(node) {
    if (!node?.isConnected) return;
    const container = scrollContainer(node.closest(messageSelector) ?? node);
    const top = node.getBoundingClientRect().top - scrollAnchor(container);
    container.scrollBy({ top, behavior: "instant" });
    lastJump = { node, container, top: container.scrollTop };
    selectedResult = node;
    updateNavigation();
  }

  function normalize(text) {
    return text?.replace(/\s+/g, " ").trim() ?? "";
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
      const node = match.matches(content) ? match : match.querySelector(content) ?? match;
      if (visible(node)) nodes.set(node, reply ? "ChatGPT" : "You");
    }
    return nodes;
  }

  function describeItem(node, mode) {
    if (mode === "code") {
      const code = node.querySelector("code") ?? node;
      const language = Array.from(code.classList).find((name) => name.startsWith("language-"))?.slice(9);
      return { label: language ? `${language} code` : "Code block", text: normalize(code.innerText) };
    }
    if (mode === "tables") {
      return { label: normalize(node.querySelector("caption")?.innerText) || "Table", text: normalize(node.innerText) };
    }
    const tag = node.localName;
    const label = tag === "img" ? "Image" : tag === "iframe" ? "Embed" : "Chart";
    const caption = normalize(node.closest("figure")?.querySelector("figcaption")?.innerText);
    const description = normalize(node.getAttribute("alt") || node.getAttribute("aria-label") ||
      node.getAttribute("title") || node.querySelector("title")?.textContent);
    const text = Array.from(new Set([caption, description])).filter(Boolean).join(" · ");
    return { label, text };
  }

  function collectItems(mode) {
    const messages = messageNodes(messageSelector);
    if (mode === "conversation") {
      return Array.from(messages, ([node, label]) => ({ node, label, text: normalize(node.innerText) }));
    }

    const { selector } = views[mode];
    const items = new Map();
    for (const message of messages.keys()) {
      for (const node of message.querySelectorAll(selector)) {
        const parentItem = node.parentElement.closest(selector);
        if (!visible(node) || (parentItem && message.contains(parentItem))) continue;
        if (node.localName === "img" && node.naturalWidth > 0 && node.naturalWidth < 40 && node.naturalHeight < 40) continue;
        items.set(node, { node, ...describeItem(node, mode) });
      }
    }
    return Array.from(items.values());
  }

  function chooseResult(node) {
    if (!node) return;
    jumpTo(node);
    rows.get(node)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  function stepResult(direction) {
    const targets = Array.from(rows.keys());
    if (!targets.length) return;
    const index = targets.indexOf(selectedResult);
    const position = index === -1 ? (direction === 1 ? 0 : targets.length - 1) :
      (index + direction + targets.length) % targets.length;
    chooseResult(targets[position]);
  }

  function renderList() {
    const query = normalize(search.value).toLowerCase();
    const browsingPrompts = isPromptList();
    const entries = browsingPrompts ? prompts : collectItems(view.value);
    const noun = browsingPrompts ? "prompt" : views[view.value].noun ?? "message";
    const results = [];
    entries.forEach(({ node, label, text }, index) => {
      const labelMatches = label?.toLowerCase().includes(query);
      const offset = text.toLowerCase().indexOf(query);
      if (query && offset < 0 && !labelMatches) return;
      const start = Math.max(0, offset - 48);
      const end = start + 150;
      const excerpt = `${start ? "…" : ""}${text.slice(start, end)}${text.length > end ? "…" : ""}`;
      results.push({ node, label: browsingPrompts ? String(index + 1) : label, excerpt, browsingPrompts });
    });

    const total = entries.length;
    const summary = query ? `${results.length} of ${total} ${noun}${total === 1 ? "" : "s"}` :
      `${total} ${noun}${total === 1 ? "" : "s"}`;
    if (status.textContent !== summary) status.textContent = summary;
    if (results.length === displayed.length && results.every(({ node, label, excerpt, browsingPrompts }, index) => (
      node === displayed[index].node && label === displayed[index].label && excerpt === displayed[index].excerpt &&
      browsingPrompts === displayed[index].browsingPrompts
    ))) {
      updateNavigation();
      return;
    }
    displayed = results;
    list.classList.toggle("details", !browsingPrompts);
    const focusedRow = shadow.activeElement;
    const items = document.createDocumentFragment();
    let nextFocus;
    const visibleRows = new Map();

    for (const { node, label, excerpt } of results) {
      const button = element("button", "", { type: "button" });
      button.append(element("span", label, { class: browsingPrompts ? "number" : "label" }));
      if (excerpt) button.append(element("span", excerpt));
      button.addEventListener("click", () => chooseResult(node));
      const item = element("li");
      item.append(button);
      items.append(item);
      visibleRows.set(node, button);
      if (focusedRow && focusedRow === rows.get(node)) nextFocus = button;
    }
    rows = visibleRows;
    list.replaceChildren(items);
    updateNavigation();
    nextFocus?.focus({ preventScroll: true });
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      renderList();
      search.focus({ preventScroll: true });
    }
  }

  function refreshPrompts() {
    refreshFrame = 0;
    const routeChanged = pathname !== location.pathname;
    if (routeChanged) {
      pathname = location.pathname;
      lastJump = undefined;
      selectedResult = undefined;
      search.value = "";
    }

    const updated = Array.from(messageNodes(promptSelector).keys(), (node) => ({
      node,
      text: normalize(node.innerText) || "Prompt with no text",
    }));
    const unchanged = !routeChanged && updated.length === prompts.length && updated.every(({ node, text }, index) => (
      node === prompts[index].node && text === prompts[index].text
    ));
    if (unchanged && (panel.hidden || isPromptList())) return;

    prompts = updated;
    host.hidden = !prompts.length;
    if (host.hidden) setOpen(false);
    if (!panel.hidden) renderList();
  }

  function scheduleRefresh() {
    if (!refreshFrame) refreshFrame = requestAnimationFrame(refreshPrompts);
  }

  function touchesMessage(record) {
    const selector = panel.hidden || isPromptList() ? promptSelector : messageSelector;
    const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (host.contains(target)) return false;
    if (record.type === "attributes" || target?.closest(selector)) return true;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE && (
      node.matches(selector) || node.querySelector(selector)
    ));
  }

  launcher.addEventListener("click", () => setOpen(panel.hidden));
  previous.addEventListener("click", () => {
    if (isPromptList()) jumpTo(prompts[indexAtViewport() - 1]?.node);
    else stepResult(-1);
  });
  next.addEventListener("click", () => {
    if (isPromptList()) jumpTo(prompts[indexAtViewport() + 1]?.node);
    else stepResult(1);
  });
  latest.addEventListener("click", () => {
    if (isPromptList()) jumpTo(prompts.at(-1)?.node);
    else chooseResult(Array.from(rows.keys()).at(-1));
  });
  search.addEventListener("input", () => {
    selectedResult = undefined;
    renderList();
  });
  view.addEventListener("change", () => {
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
    if (panel.hidden || event.composedPath().includes(host) || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!panel.hidden) updateNavigation();
    });
  }, { capture: true, passive: true });
  window.addEventListener("popstate", scheduleRefresh);

  const observer = new MutationObserver((records) => {
    if (pathname !== location.pathname || records.some(touchesMessage)) scheduleRefresh();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-message-author-role", "data-user-message-bubble", "data-turn", "data-content-search-unit-key"],
  });
  refreshPrompts();
})();
