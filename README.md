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

## Use

- Click **Navigate chat** near the upper right or press **Alt+Shift+J** to open the navigator.
- In **Conversation**, browse your prompts or type to search both prompts and replies.
- Choose **Code blocks**, **Tables**, or **Charts & images** to list those items. You can search the selected list by its text or available captions and labels.
- Click a result to jump to it. In the search box, press **Enter** or **Shift+Enter** to cycle forward or backward. Press **Esc** to close the panel.

Search and jump lists cover items ChatGPT has loaded in the tab. If ChatGPT loads older messages as you scroll, the lists update as those messages appear.
