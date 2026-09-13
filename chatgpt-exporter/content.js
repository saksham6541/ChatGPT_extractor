/**
 * content.js
 * Runs on ChatGPT, Claude, and Gemini.
 * Handles scraping on ChatGPT pages and injection on target pages.
 */

// ---------- Platform detection ----------
function getPlatform() {
  const host = location.hostname;
  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) return "chatgpt";
  if (host.includes("claude.ai")) return "claude";
  if (host.includes("gemini.google.com")) return "gemini";
  return null;
}

// ---------- ChatGPT selectors (resilient strategy) ----------
/**
 * HOW TO UPDATE SELECTORS WHEN CHATGPT CHANGES:
 * 1. Open DevTools → Elements.
 * 2. Inspect a user message and an assistant message.
 * 3. Prefer attributes that are semantic:
 *    - data-message-author-role="user|assistant"
 *    - data-testid^="conversation-turn-"
 *    - [data-turn]
 *    - h5.sr-only / h6.sr-only ("You said:", "ChatGPT said:")
 * 4. Avoid pure Tailwind class chains (.flex.xxx) – they break often.
 * 5. Keep a fallback chain (try several selectors in order).
 */
const CHATGPT_SELECTORS = {
  // Message containers (most stable first)
  turn: [
    'article[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn-"]',
    '[data-turn]',
    'div[data-message-author-role]'
  ],
  // Role detection
  roleAttr: '[data-message-author-role]',
  // Content areas inside a turn
  content: [
    '.markdown',
    '.prose',
    '[class*="markdown"]',
    'div[data-message-author-role] > div',
    '.whitespace-pre-wrap'
  ],
  // Screen-reader role markers (very stable)
  srUser: 'h5.sr-only, h4.sr-only',
  srAssistant: 'h6.sr-only, h5.sr-only',
  // Scroll container candidates (for loading full history)
  scrollContainer: [
    'div[data-testid="conversation-turns"]',
    'main div.overflow-y-auto',
    'div.flex.h-full.flex-col.overflow-y-auto',
    'div[class*="overflow-y-auto"]'
  ]
};

// ---------- Target site input selectors ----------
const INPUT_SELECTORS = {
  claude: [
    'div[contenteditable="true"].ProseMirror',
    'div.ProseMirror[contenteditable="true"]',
    '[data-placeholder*="Reply"]',
    'div[contenteditable="true"][role="textbox"]'
  ],
  gemini: [
    'rich-textarea .ql-editor',
    'div[contenteditable="true"].ql-editor',
    'div[contenteditable="true"].textarea',
    'div[contenteditable="true"][aria-label*="message" i]'
  ],
  chatgpt: [
    '#prompt-textarea',
    'div#prompt-textarea.ProseMirror',
    'div[contenteditable="true"][data-id="root"]'
  ]
};

// ---------- Utility: find first matching element ----------
function queryFirst(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(selectors, root = document) {
  for (const sel of selectors) {
    const nodes = root.querySelectorAll(sel);
    if (nodes.length) return Array.from(nodes);
  }
  return [];
}

// ---------- Scroll to load full history (ChatGPT virtualization) ----------
async function loadFullHistory() {
  const container = queryFirst(CHATGPT_SELECTORS.scrollContainer) || document.scrollingElement;
  if (!container) return;

  const maxAttempts = 30;
  let lastHeight = 0;
  let attempts = 0;

  while (attempts < maxAttempts) {
    container.scrollTop = 0; // scroll to top to trigger older messages
    await new Promise(r => setTimeout(r, 400));
    const newHeight = container.scrollHeight;
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
    attempts++;
  }
  // scroll back a bit so UI feels natural
  container.scrollTop = Math.min(300, container.scrollHeight);
}

// ---------- Extract text while preserving markdown-ish structure ----------
function extractContent(node) {
  if (!node) return "";

  // Prefer innerText for readable order; fall back to textContent
  let text = (node.innerText || node.textContent || "").trim();

  // Detect images / attachments and note them
  const images = node.querySelectorAll("img");
  const hasImages = images.length > 0;
  if (hasImages) {
    text += "\n\n[Image(s) or attachment present – binary content skipped]";
  }

  // Simple cleanup of extra blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

// ---------- Main scrape function ----------
async function scrapeConversation() {
  const platform = getPlatform();
  if (platform !== "chatgpt") {
    return { success: false, error: "Not on a ChatGPT page." };
  }

  // Try to load full history (important for long chats)
  try {
    await loadFullHistory();
  } catch (e) {
    console.warn("History load warning:", e);
  }

  const turns = queryAll(CHATGPT_SELECTORS.turn);
  const messages = [];

  // Fallback: if no turns found, try all role-attributed nodes
  const candidates = turns.length
    ? turns
    : Array.from(document.querySelectorAll(CHATGPT_SELECTORS.roleAttr));

  for (const turn of candidates) {
    let role = null;

    // 1. Explicit data attribute
    const roleEl = turn.matches(CHATGPT_SELECTORS.roleAttr)
      ? turn
      : turn.querySelector(CHATGPT_SELECTORS.roleAttr);
    if (roleEl) {
      role = roleEl.getAttribute("data-message-author-role");
    }

    // 2. Screen-reader headings
    if (!role) {
      if (turn.querySelector(CHATGPT_SELECTORS.srUser)?.textContent?.includes("You")) {
        role = "user";
      } else if (turn.querySelector(CHATGPT_SELECTORS.srAssistant)?.textContent?.match(/ChatGPT|Assistant/i)) {
        role = "assistant";
      }
    }

    // 3. Heuristic from data-turn or class
    if (!role) {
      const dataTurn = turn.getAttribute("data-turn");
      if (dataTurn === "user") role = "user";
      else if (dataTurn === "assistant") role = "assistant";
    }

    if (!role || (role !== "user" && role !== "assistant")) continue;

    // Content extraction
    let contentNode = queryFirst(CHATGPT_SELECTORS.content, turn) || turn;
    const content = extractContent(contentNode);

    if (!content) continue; // skip empty (virtualized) nodes

    messages.push({
      role,
      content,
      timestamp: new Date().toISOString() // approximate; real timestamps are hard to get from DOM
    });
  }

  // Deduplicate consecutive identical messages (can happen with virtualization)
  const deduped = [];
  for (const m of messages) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.role !== m.role || prev.content !== m.content) {
      deduped.push(m);
    }
  }

  if (deduped.length === 0) {
    return { success: false, error: "No messages found. Try scrolling the chat or check selectors." };
  }

  // Store in chrome.storage.local
  await chrome.storage.local.set({
    lastConversation: deduped,
    lastScrapedAt: new Date().toISOString(),
    messageCount: deduped.length
  });

  return {
    success: true,
    count: deduped.length,
    messages: deduped
  };
}

// ---------- Convert to Markdown ----------
function toMarkdown(messages) {
  return messages
    .map(m => {
      const header = m.role === "user" ? "**User**" : "**Assistant**";
      return `${header}\n\n${m.content}\n\n---\n`;
    })
    .join("\n");
}

// ---------- Helpers for injecting into rich-text editors (ProseMirror/Quill) ----------
/**
 * ProseMirror, Quill, and Lexical all maintain their own internal document
 * model and re-render the DOM from it. Manually appending <p> tags and firing
 * a synthetic "input" event does NOT go through their edit pipeline, so the
 * editor either ignores the change or reverts it on the next render.
 *
 * The two techniques below trigger the browser's *real* native text-insertion
 * behavior, which these editors listen for via native "beforeinput"/"input"/
 * "paste" events (the same path used when a human types or pastes):
 *   1. document.execCommand("insertText") - still supported by Chrome,
 *      performs a genuine native insertion.
 *   2. Dispatching a real "paste" ClipboardEvent with DataTransfer - mimics
 *      an actual paste, which is exactly what these editors are built to handle.
 * We try (1) first since it's simpler, verify the DOM actually changed, and
 * fall back to (2) if it didn't.
 */
function selectAllContent(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function tryExecCommandInsert(el, text) {
  selectAllContent(el);
  // Remove any existing content first
  document.execCommand("delete", false, null);
  const ok = document.execCommand("insertText", false, text);
  return ok && el.innerText.trim().length > 0;
}

function tryPasteEventInsert(el, text) {
  selectAllContent(el);
  document.execCommand("delete", false, null);
  el.focus();

  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);
  const pasteEvent = new ClipboardEvent("paste", {
    clipboardData: dataTransfer,
    bubbles: true,
    cancelable: true
  });
  el.dispatchEvent(pasteEvent);
  return el.innerText.trim().length > 0;
}

// ---------- Inject into target input ----------
async function injectConversation(targetPlatform) {
  const { lastConversation } = await chrome.storage.local.get("lastConversation");
  if (!lastConversation || !lastConversation.length) {
    return { success: false, error: "No scraped conversation found. Scrape first." };
  }

  // For very long chats, summarize / truncate warning
  let textToInject = toMarkdown(lastConversation);
  const MAX_CHARS = 120000; // safe-ish limit for most UIs
  if (textToInject.length > MAX_CHARS) {
    textToInject =
      textToInject.slice(0, MAX_CHARS) +
      "\n\n[... conversation truncated because it was too long. Full JSON available via Download.]";
  }

  // Prefix with a clear system-style instruction
  const prefix =
    "The following is a previous conversation I had. Please continue from here as if you are the same assistant, preserving context:\n\n";
  textToInject = prefix + textToInject;

  const selectors = INPUT_SELECTORS[targetPlatform] || INPUT_SELECTORS.claude;
  const input = queryFirst(selectors);

  if (!input) {
    return {
      success: false,
      error: `Could not find input box on ${targetPlatform}. The site's UI may have changed - try Copy Markdown and paste manually instead.`
    };
  }

  input.focus();

  if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
    // Native form fields: setting .value + dispatching input/change is reliable here,
    // no rich-text editor model to fight with.
    input.value = textToInject;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, chars: textToInject.length, method: "value" };
  }

  // contenteditable / ProseMirror / Quill: try native execCommand first
  let method = "execCommand";
  let inserted = false;
  try {
    inserted = tryExecCommandInsert(input, textToInject);
  } catch (e) {
    console.warn("execCommand insert failed:", e);
  }

  if (!inserted) {
    method = "paste-event";
    try {
      inserted = tryPasteEventInsert(input, textToInject);
    } catch (e) {
      console.warn("paste-event insert failed:", e);
    }
  }

  if (!inserted) {
    return {
      success: false,
      error:
        `Found the input box on ${targetPlatform} but couldn't insert text into it automatically ` +
        `(the editor rejected both insertion methods). Use "Copy Markdown" and paste manually instead.`
    };
  }

  return { success: true, chars: textToInject.length, method };
}

// ---------- Clipboard write with fallback ----------
/**
 * navigator.clipboard.writeText() can silently reject if the document
 * doesn't have focus (common right after a popup closes) or if the
 * Clipboard API is otherwise blocked. Fall back to the legacy
 * textarea + execCommand("copy") approach, which is more forgiving.
 */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("navigator.clipboard.writeText failed, trying fallback:", e);
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.warn("Fallback clipboard copy also failed:", e);
    return false;
  }
}

// ---------- Message listener ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "scrapeConversation") {
        const result = await scrapeConversation();
        sendResponse(result);
      } else if (message.action === "getStatus") {
        const data = await chrome.storage.local.get(["messageCount", "lastScrapedAt"]);
        sendResponse({ success: true, ...data });
      } else if (message.action === "copyMarkdown") {
        const { lastConversation } = await chrome.storage.local.get("lastConversation");
        if (!lastConversation) {
          sendResponse({ success: false, error: "Nothing scraped yet." });
          return;
        }
        const md = toMarkdown(lastConversation);
        const copied = await writeClipboard(md);
        if (copied) {
          sendResponse({ success: true, length: md.length });
        } else {
          sendResponse({
            success: false,
            error: "Clipboard write blocked by the browser. Try clicking on the page first, then Copy Markdown again."
          });
        }
      } else if (message.action === "download") {
        const { lastConversation } = await chrome.storage.local.get("lastConversation");
        if (!lastConversation) {
          sendResponse({ success: false, error: "Nothing scraped yet." });
          return;
        }
        const format = message.format || "json";
        let content, filename, mime;
        if (format === "md") {
          content = toMarkdown(lastConversation);
          filename = `chatgpt-conversation-${Date.now()}.md`;
          mime = "text/markdown";
        } else {
          content = JSON.stringify(lastConversation, null, 2);
          filename = `chatgpt-conversation-${Date.now()}.json`;
          mime = "application/json";
        }
        // Trigger download via data URL (works from content script in most cases)
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        sendResponse({ success: true, filename });
      } else if (message.action === "inject") {
        const result = await injectConversation(message.target);
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message || String(err) });
    }
  })();
  return true; // keep channel open for async response
});

console.log("[ChatGPT Exporter] content script loaded on", location.hostname);
