// popup.js

const statusEl = document.getElementById("status");

function setStatus(html, isError = false) {
  statusEl.innerHTML = html;
  statusEl.style.borderLeft = isError ? "3px solid #e74c3c" : "3px solid #10a37f";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(action, extra = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab.", true);
    return null;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action, ...extra });
    return response;
  } catch (e) {
    // Content script may not be injected yet (e.g. just navigated)
    setStatus("Content script not ready. Refresh the page and try again.", true);
    return null;
  }
}

async function refreshStatus() {
  const data = await chrome.storage.local.get(["messageCount", "lastScrapedAt"]);
  if (data.messageCount) {
    const time = data.lastScrapedAt
      ? new Date(data.lastScrapedAt).toLocaleTimeString()
      : "unknown";
    setStatus(`Captured <strong>${data.messageCount}</strong> messages<br><small>Last scrape: ${time}</small>`);
  }
}

document.getElementById("btnScrape").addEventListener("click", async () => {
  setStatus("Scraping… (may scroll to load history)");
  const res = await sendToContent("scrapeConversation");
  if (!res) return;
  if (res.success) {
    setStatus(`Captured <strong>${res.count}</strong> messages successfully.`);
  } else {
    setStatus(res.error || "Scrape failed.", true);
  }
});

document.getElementById("btnCopy").addEventListener("click", async () => {
  const res = await sendToContent("copyMarkdown");
  if (!res) return;
  if (res.success) {
    setStatus(`Copied Markdown (${res.length} chars) to clipboard.`);
  } else {
    setStatus(res.error || "Copy failed.", true);
  }
});

document.getElementById("btnJson").addEventListener("click", async () => {
  const res = await sendToContent("download", { format: "json" });
  if (res?.success) setStatus(`Downloaded ${res.filename}`);
  else if (res) setStatus(res.error, true);
});

document.getElementById("btnMd").addEventListener("click", async () => {
  const res = await sendToContent("download", { format: "md" });
  if (res?.success) setStatus(`Downloaded ${res.filename}`);
  else if (res) setStatus(res.error, true);
});

async function handleSendTo(target, url) {
  const { lastConversation } = await chrome.storage.local.get("lastConversation");
  if (!lastConversation?.length) {
    setStatus("Scrape a conversation first.", true);
    return;
  }

  const hostMatch = target === "claude" ? "claude.ai" : "gemini.google.com";
  const tab = await getActiveTab();

  if (tab?.url?.includes(hostMatch)) {
    setStatus(`Injecting into ${target}…`);
    const res = await sendToContent("inject", { target });
    if (res?.success) setStatus(`Injected into ${target} (${res.chars} chars, via ${res.method}).`);
    else setStatus(res?.error || "Injection failed.", true);
    return;
  }

  // Opening a new tab steals window focus, which closes this popup immediately -
  // so we hand off to background.js, which stays alive and does the actual
  // "wait for load, then inject" work. Watch the extension icon badge (✓/!) for
  // the result once the new tab finishes loading.
  chrome.runtime.sendMessage({ action: "openAndInject", target, url });
  setStatus(`Opening ${target} - it'll auto-inject once the page loads. Watch the toolbar icon for a ✓ or !.`);
}

document.getElementById("btnClaude").addEventListener("click", () => {
  handleSendTo("claude", "https://claude.ai/new");
});

document.getElementById("btnGemini").addEventListener("click", () => {
  handleSendTo("gemini", "https://gemini.google.com/app");
});

// Initial status
refreshStatus();
