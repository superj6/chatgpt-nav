# ChatGPT Conversation Navigator

A local Firefox extension for navigating and searching the current ChatGPT conversation. It reads the conversation displayed in the tab, sends no network requests, and saves no conversation data.

## Try it in Firefox

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on** and select `manifest.json` from this folder or the [packaged ZIP](chatgpt-conversation-navigator.zip).
3. Refresh your ChatGPT tab and open a conversation with at least one prompt.

Firefox removes temporary add-ons when it restarts. Repeat steps 1–3 to load it again. [Mozilla’s temporary installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)

## Install permanently

1. Sign in to Mozilla’s Add-on Developer Hub, start a submission, and choose **On your own** to keep the add-on unlisted. [Submit a New Add-on](https://addons.mozilla.org/en-US/developers/addon/submit/)
2. Upload the [packaged ZIP](chatgpt-conversation-navigator.zip) and download the signed `.xpi` when Mozilla finishes signing it. [Mozilla’s signing instructions](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/#self-distribution)
3. Open `about:addons` in Firefox, click the gear icon, and use **Install Add-on From File** to select the signed `.xpi`. [Mozilla’s installation instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-a-computer)

To update an existing installation, open your add-on in **My Add-ons** and upload the ZIP as a new version. Once it is signed, choose **View All** under the latest version, open the new version, and right-click its file link to **Save Link As**. Install that signed file through `about:addons` and reload the ChatGPT tab. [Mozilla Developer Hub](https://addons.mozilla.org/en-US/developers/addons)

## Use

- Click **Navigate chat** near the upper right or press **Alt+Shift+J** to open the navigator.
- In **Conversation**, browse your prompts or type to search both prompts and replies.
- If older items are missing, click **Scan full chat**. The navigator scrolls through the conversation, indexes what ChatGPT loads, and returns to your starting position. **Stop scan** ends the scan early.
- Choose **Outline** to jump to headings or **Top-level only** to hide subheadings. You can also browse **Code blocks**, **Tables**, **Charts & images**, **Lists**, or **Quotes**. These views group items by message and let you expand or collapse each group or all groups together.
- Click an item to jump to it. **Previous** and **Next** move within the selected view, using where you are in the conversation or the last item you jumped to. In the search box, **Enter** or **Shift+Enter** cycles through results. **Esc** closes the panel.

The index is kept in memory for the current tab and clears when you switch chats or reload. It covers the content ChatGPT makes available as you scroll.

## Tests

Open [tests/navigator.html](tests/navigator.html) directly in Firefox. It reports **PASS** or the first failing check and uses synthetic conversation data. It tests actual scroll positions, Previous and Next, outline controls, searchable content, and jumps to items that have been scrolled out of the page.
