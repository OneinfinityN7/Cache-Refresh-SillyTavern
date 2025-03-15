# SillyTavern Cache Refresher Extension

[![Status](https://img.shields.io/badge/status-ready-green.svg)]()

This extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) automatically keeps your language model's cache "warm" by sending periodic, minimal requests. While designed primarily for Claude Sonnet, it works with other models as well. By preventing cache expiration, you can significantly reduce API costs.

## The Problem: Cache Expiration

AI language models (LLMs) like Claude (through OpenRouter), OpenAI's GPT, and others use caching to improve performance and reduce costs. When you send a prompt that's similar to a recent one, or enable caching on your prompts, the service can often return a cached response instead of recomputing everything, resulting in a cache discount (90% reduction of the cached input price for Claude).

However, these caches typically have a short lifespan (often just a few minutes). If you pause your interaction with the model longer than the cache timeout, the cache expires, and your next request incurs the full cost. Additionally, enabling caching itself may have costs for some models (Claude charges 1.25x the original input price for caching).

## The Solution: Cache Refreshing

*   When you send a message and receive a response, the extension captures the prompt data.
*   It then schedules a series of refresh requests (up to the maximum number configured).
*   If a new message is sent, the refresh timer will stop and then restart after the new response is received.
*   Each refresh request sends a minimal request to the API to just to keep the cache alive.
*   A floating status indicator shows the number of remaining refreshes and a countdown timer, and a notification appear after each succesful refresh.
*   If you change or leave the conversation, the timer will stop.

### Price Comparison with Claude Sonnet 3.7 using OpenRouter Logs

#### 12 messages conversation

| Caching Method | Prompt Tokens | Completion Tokens | Total Cost | % of Base Price |
|----------------|---------------|-------------------|------------|-----------------|
| No caching | 4091 ($0.012273) | 414 ($0.00621) | $0.0185 | 100% |
| Depth 2 + System | 4091 ($0.00379) | 414 ($0.00621) | $0.01 | 54% |
| Cache refresh | 4091 ($0.00254) | 2 ($0.00003) | $0.00257 | 14% |

Could have refresh 3 times (20 minutes between messages) and it would have cost you less than paying full price for the next message.

#### 76 messages conversation

| Caching Method | Prompt Tokens | Completion Tokens | Total Cost | % of Base Price |
|----------------|---------------|-------------------|------------|-----------------|
| No caching | 14412 ($0.04323) | 298 ($0.00447) | $0.0477 | 100% |
| Depth 2 + System | 14412 ($0.00653) | 298 ($0.00447) | $0.011 | 23% |
| Cache refresh | 14412 ($0.00541) | 2 ($0.00003) | $0.00544 | 11% |

Could have refresh 6 times (35 minutes between messages) and it would have cost you less than paying full price for the next message.

## Installation

1.  **Prerequisites:** You must have SillyTavern installed and running.
2.  **Install the Extension:** In SillyTavern, go to the Extensions menu (the puzzle piece icon). Click the "Install extension" button (top right) and enter: https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern
3.  **Enable the Extension:** In the Extensions menu, you'll find a new "Cache Refresher" panel containing all the extension's options.

## Troubleshooting

*   **Extension Not Appearing:** Ensure you've installed the extension correctly and restarted SillyTavern.
*   **No Notifications:** Check that "Show Notifications" is enabled in the extension settings. If notifications are still not appearing, you may need to modify the CSS template yourself to ensure proper display.

*   **No Cache Reduction:**
    *   Verify that your model supports caching.
    *   Note that other extensions may interfere with cache refreshing functionality.
    *   For Claude:
      * Check your config.yaml file for caching settings, specifically `enableSystemPromptCache` and `cachingAtDepth`. (Note: On OpenRouter, system prompt caching is always enabled regardless of `enableSystemPromptCache`)
      * Restart SillyTavern after modifying these configuration parameters.
      * Ensure you're using `Chat Completion` mode, as Claude doesn't support caching for `Text Completion`.
      * For optimal caching, it's recommended to set `cachingAtDepth` to an even number. The number represents caching depth: 0 is your most recent message (not recommended), 2 represents the two previous messages before (usually sufficient).
      * When using `enableSystemPromptCache` (Claude endpoints only, always on for OpenRouter), avoid random elements or lorebooks in your system prompt.
      * Learn more about Claude caching at: https://rentry.org/pay-the-piper-less
      * Be aware that `openai_max_context` in your `Chat Completion` settings can provoke unexpected behavior.
      * If (`openai_max_tokens` + total prompt tokens) exceeds `openai_max_context`, your conversation history will be truncated from the beginning to ensure that `openai_max_tokens` is never exceeded at the end of your completion.
*   **Cache Still Expiring:**
    *   Confirm the extension is enabled and running.
    *   Set refresh intervals shorter than your model's cache timeout period.
    *   Use SillyTavern's API panel to compare the extension's refreshed prompts with the original prompts.
    *   Look for error messages in the browser's developer console (F12).

## License

This extension is released under the [MIT License](LICENSE).
