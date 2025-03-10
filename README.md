# SillyTavern Cache Refresher Extension

[![Status](https://img.shields.io/badge/status-beta-yellow.svg)]()

This extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) automatically keeps your language model's cache "warm" by sending periodic, minimal requests. This was made for Claude Sonnet especially, but it works with other models as well. By preventing cache expiration, you can significantly reduce API cost.

## The Problem: Cache Expiration

AI language models (LLMs) like Claude (through OpenRouter), OpenAI's GPT, and others use caching to improve performance and reduce costs. When you send a prompt that's similar to a recent one, or asking caching on your prompts, the service can often return a cached response instead of recomputing everything, which in turn will give a cache discount. (90% reduction of the price of the cached input for Claude)

However, these caches have a short lifespan (often just a few minutes). If you pause your interaction with the model for longer than the cache timeout, the cache expires, and the next request incurs the full cost. This is without mentioning that caching can cost you for some model. (Charged 1.25x the price of the original input pricing for Claude)

## The Solution: Cache Refreshing

This extension solves this problem by:

1.  **Capturing Prompts:** After each successful generation, the extension captures the prompt sent to the AI model.
2.  **Scheduling Refreshes:** It then schedules periodic "ping" requests to be sent to the API. These requests are designed to be minimal (requesting only a single token) to keep the cache alive without incurring significant costs.
3.  **Configurable Settings:** You can configure:
    *   **Refresh Interval:** How often to send the refresh requests (default: 4 minutes 30 seconds, optimized for typical cache lifetimes).
    *   **Maximum Refreshes:** The maximum number of refresh requests to send before stopping (default: 3).
    *   **Minimum Tokens:** The number of tokens to request in each refresh (default: 1).
    *   **Show Notifications:** Whether to display toast notifications for each refresh.

## Benefits

*   **Reduced API Costs:** Avoid paying full price if your too slow.
*   **Automated:** Works in the background; no manual intervention is needed.
*   **OpenRouter/Claude Optimized:** While it works with other model, it's particularly beneficial for OpenRouter's Claude Sonnet, which has a short cache lifetime.

## Installation

1.  **Prerequisites:** You must have SillyTavern installed and running.
2.  **Install the Extension:** In SillyTavern, go to the Extensions menu (the puzzle piece icon). You should see a button labeled "Install extension". Click it and enter https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern
3.  **Enable the Extension:** Also in the Extensions menu, you should see a new panel call Cache Refresher with all the options of the extension.

## Usage

Once enabled, the extension works automatically in the background. If you've enabled the status indicator, you'll see in the bottom right corner the number of remaining refreshes and a countdown timer. If you've enabled notifications, you'll also see a toast message each time the cache is refreshed.

## Technical Details

*   **Dependencies:** This extension relies on SillyTavern's core functionality, including its event system, API request handling, and settings management. It also uses jQuery (which is included with SillyTavern) and standard browser APIs.
*   **Event-Driven:** The extension listens for SillyTavern events to capture prompts and trigger refresh cycles.
    *   Listens for `CHAT_COMPLETION_PROMPT_READY` events to capture prompts.
    *   Listens for `MESSAGE_RECEIVED` to start the refresh cycle.
    *   Listens for `CHAT_CHANGED` events to stop the refresh cycle and clear data when the user switches chats.
*   **API Requests:** The extension uses SillyTavern's built-in `sendGenerationRequest` function to send the refresh requests. This ensures that the correct API endpoint, authentication, and settings are used.
*   **Settings:** Settings are stored using SillyTavern's `extension_settings` object, making them persistent across sessions.
*   **UI Integration:** The extension adds a settings panel to SillyTavern's extensions menu and a floating status indicator.

## How It Works

1.  When you send a message and receive a response, the extension captures the prompt data.
2.  It then schedules a series of refresh requests (up to the maximum number configured), if a prompt has been captured.
3.  Each refresh request sends a minimal request to the API to keep the cache alive.
4.  A floating status indicator shows the number of remaining refreshes and a countdown timer.
5.  When the maximum number of refreshes is reached, or no prompt is available, the cycle stops until you send another message and a response is received.

## Troubleshooting

*   **Extension Not Appearing:** Make sure you've installed the extension correctly and restarted SillyTavern.
*   **No Notifications:** Check that "Show Notifications" is enabled in the extension's settings.

*   **No Cache Reduction:**
    *   Make sure the model you're using as cache reduction. 
    *   For Claude, make sure that you have activated cache in the config.yaml the options are `enableSystemPromptCache` and `cachingAtDepth`. For a better experience with caching, I would suggest to only active `cachingAtDepth` and put in on an even number. The number correspond to the caching depth, 0 is the message you just send, which is probably {{user}} (don't do this), 2 is the two previous message, which is also probably {{user}} (good enough most of the time). If you activate `enableSystemPromptCache` make sure that your prompt does not have any random element. 
*   **Cache Still Expiring:**
    *   Ensure the extension is enabled.
    *   Check the refresh interval. It should be *shorter* than the cache lifetime of your chosen API/model.
    *   Check SillyTavern API to see the prompt send by the extension and compare it to the original prompt send.
    *   Some APIs might have very short or unpredictable cache lifetimes.
    *   Check the browser's developer console (usually opened with F12) for error messages.

## Contributing

Contributions are welcome! If you find a bug or have a feature request, please open an issue on this GitHub repository. If you'd like to contribute code, please fork the repository and submit a pull request.

## License

This extension is released under the [MIT License](LICENSE).
