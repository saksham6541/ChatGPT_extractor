// background.js – service worker for context menu + messaging bridge

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scrape-chatgpt-conversation",
    title: "Scrape ChatGPT Conversation",
    contexts: ["page"],
    documentUrlPatterns: [
      "https://chatgpt.com/*",
      "https://chat.openai.com/*"
    ]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "scrape-chatgpt-conversation" && tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "scrapeConversation" });
    } catch (e) {
      console.error("Context menu scrape failed:", e);
    }
  }
});

// Optional: keep a simple message relay if needed later
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "log") {
    console.log("[Exporter]", message.data);
    return false;
  }

  if (message.action === "openAndInject") {
    // Fire-and-forget from the popup's perspective: the popup closes the
    // instant chrome.tabs.create() steals window focus, so all of this has
    // to run here in the service worker (which keeps running after the
    // popup dies) rather than in popup.js.
    handleOpenAndInject(message.target, message.url);
    return false;
  }

  return false;
});

async function handleOpenAndInject(target, url) {
  try {
    const tab = await chrome.tabs.create({ url });
    await waitForTabComplete(tab.id);
    // The page reports "complete" as soon as the HTML shell loads, but these
    // are heavy SPAs - give the editor UI a moment to actually mount before
    // we go looking for it.
    await new Promise(r => setTimeout(r, 1500));
    const result = await sendInjectWithRetry(tab.id, target);
    showBadgeResult(result.success);
  } catch (e) {
    console.error("openAndInject failed:", e);
    showBadgeResult(false);
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout in case the tab never reports "complete"
    setTimeout(resolve, 15000);
  });
}

async function sendInjectWithRetry(tabId, target, attempts = 6) {
  let lastError = "Could not reach the page in time.";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "inject", target });
      if (res) return res;
    } catch (e) {
      lastError = e.message || String(e);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return {
    success: false,
    error: `${lastError} Try clicking "Send → ${target}" again from the popup now that the page is loaded.`
  };
}

// Since the popup usually isn't open anymore by the time injection finishes,
// use the toolbar badge to give visible pass/fail feedback.
function showBadgeResult(success) {
  chrome.action.setBadgeText({ text: success ? "OK" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: success ? "#10a37f" : "#e74c3c" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 6000);
}
