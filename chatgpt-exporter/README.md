# ChatGPT Conversation Exporter & Transfer

Chrome extension (Manifest V3) that scrapes the current ChatGPT conversation and lets you:

- Copy it as Markdown
- Download as JSON or Markdown
- Inject / continue the conversation on Claude.ai or Gemini

## Install (unpacked)

1. Unzip this folder.
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `chatgpt-exporter` folder
5. Pin the extension if desired

## Usage

1. Open a conversation on chatgpt.com
2. Click the extension icon → **Scrape Conversation**
3. Use Copy / Download / Send → Claude or Gemini

## Notes

- Selectors can break when ChatGPT updates its UI. See comments in `content.js` for how to update them.
- Images and file attachments are noted but not transferred (binary content).
- Very long chats may be truncated on injection; full data is in the JSON download.
