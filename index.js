/**
 * Cache Refresher Extension for SillyTavern
 *
 * This extension automatically keeps the language model's cache "warm" by sending
 * periodic minimal requests to prevent cache expiration. This helps reduce API costs.
 */

import { extension_settings } from '../../../extensions.js';
const { chatCompletionSettings, eventSource, eventTypes, renderExtensionTemplateAsync, mainApi, sendGenerationRequest } = SillyTavern.getContext();

// Stolen from script.js and modify to work for the extension.
class TempResponseLength {
    static #originalResponseLength = -1;
    static #lastApi = null;

    static isCustomized() {
        return this.#originalResponseLength > -1;
    }

    /**
     * Save the current response length for the specified API.
     * @param {string} api API identifier
     * @param {number} responseLength New response length
     */
    static save(api, responseLength) {
        if (api === 'openai') {
            this.#originalResponseLength = chatCompletionSettings.openai_max_tokens;
            chatCompletionSettings.openai_max_tokens = responseLength;
        } else {
            throw new Error(`Unsupported API in class TempResponseLength: save(api, responseLength)`);
        }

        this.#lastApi = api;
        console.log('[TempResponseLength] Saved original response length:', TempResponseLength.#originalResponseLength);
    }

    /**
     * Restore the original response length for the specified API.
     * @param {string|null} api API identifier
     * @returns {void}
     */
    static restore(api) {
        if (this.#originalResponseLength === -1) {
            return;
        }
        if (!api && this.#lastApi) {
            api = this.#lastApi;
        }
        if (api === 'openai') {
            chatCompletionSettings.openai_max_tokens = this.#originalResponseLength;
        } else {
            throw new Error(`Unsupported API in class TempResponseLength: restore(api)`);
        }

        console.log('[TempResponseLength] Restored original response length:', this.#originalResponseLength);
        this.#originalResponseLength = -1;
        this.#lastApi = null;
    }

    /**
     * Sets up an event hook to restore the original response length when the event is emitted.
     * @param {string} api API identifier
     * @returns {function(): void} Event hook function
     */
    static setupEventHook(api) {
        const eventHook = () => {
            if (this.isCustomized()) {
                this.restore(api);
            }
        };

        switch (api) {
            case 'openai':
                eventSource.once(eventTypes.CHAT_COMPLETION_SETTINGS_READY, eventHook);
                break;
            default:
                eventSource.once(eventTypes.GENERATE_AFTER_DATA, eventHook);
                break;
        }

        return eventHook;
    }

    /**
     * Removes the event hook for the specified API.
     * @param {string} api API identifier
     * @param {function(): void} eventHook Previously set up event hook
     */
    static removeEventHook(api, eventHook) {
        switch (api) {
            case 'openai':
                eventSource.removeListener(eventTypes.CHAT_COMPLETION_SETTINGS_READY, eventHook);
                break;
            default:
                eventSource.removeListener(eventTypes.GENERATE_AFTER_DATA, eventHook);
                break;
        }
    }
}

// Log extension loading attempt
console.log('Cache Refresher: Loading extension...');

// Extension name and path
const extensionName = 'Cache-Refresh-SillyTavern';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const path = `third-party/${extensionName}`;

// Default configuration
const defaultSettings = {
    enabled: false,
    refreshInterval: (5 * 60 - 30) * 1000, // 4 minutes 30 seconds in milliseconds (optimized for typical cache lifetimes)
    maxRefreshes: 3,                       // Maximum number of refresh requests to send before stopping
    maxTokens: 1,                          // Maximum tokens to request for cache refresh (keeping it minimal to reduce costs)
    showNotifications: true,               // Whether to display toast notifications for each refresh
    showStatusIndicator: true,             // Whether to display the floating status indicator
};

// Initialize extension settings
if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = {};
    console.log('Cache Refresher: Creating new settings object');
}

// Merge with defaults - preserves user settings while ensuring all required properties exist
extension_settings[extensionName] = Object.assign({}, defaultSettings, extension_settings[extensionName]);
const settings = extension_settings[extensionName];
console.log('Cache Refresher: Settings initialized', settings);

// State variables
let lastGenerationData = {
    prompt: null,                       // Stores the last prompt sent to the AI model
};      
let refreshTimer = null;                // Timer for scheduling the next refresh
let refreshesLeft = 0;                  // Counter for remaining refreshes in the current cycle
let refreshInProgress = false;          // Flag to prevent concurrent refreshes
let statusIndicator = null;             // DOM element for the floating status indicator
let nextRefreshTime = null;             // Timestamp for the next scheduled refresh
let statusUpdateInterval = null;        // Interval for updating the countdown timer
const cachingAtDepth = 2;               // For essential caching. Depth of the caching (couldn't verify the config.yaml directly) 
// No system caching for OpenRouter.

/**
 * Logs a message to console with extension prefix for easier debugging
 * @param {string} message - Message to log
 * @param {any} data - Optional data to log
 */
function debugLog(message, data) {
    console.log(`[Cache Refresher] ${message}`, data || '');
}

/**
 * Shows a notification if notifications are enabled in settings
 * @param {string} message - Message to show
 * @param {string} type - Notification type (success, info, warning, error)
 */
function showNotification(message, type = 'info') {
    if (settings.showNotifications) {
        toastr[type](message, '', { timeOut: 3000 });
    }
}

/**
 * Check if the current API is using chat completion format
 * @returns {boolean} True if using a chat completion API
 */
function isChatCompletion() {
    return mainApi === 'openai';
}

/**
 * Updates the extension settings in localStorage via SillyTavern's extension_settings
 * This ensures settings persist between sessions
 */
async function saveSettings() {
    try {
        extension_settings[extensionName] = settings;
        debugLog('Settings saved', settings);
    } catch (error) {
        console.error('Cache Refresher: Error saving settings:', error);
        showNotification('Error saving settings', 'error');
    }
}

/**
 * Updates all UI elements to reflect current state
 * This is called whenever the extension state changes
 */
function updateUI() {
    // Update both the floating status indicator and the settings panel
    updateStatusIndicator();
    updateSettingsPanel();
}

/**
 * Creates or updates the floating status indicator
 * This shows the number of remaining refreshes and countdown timer
 */
function updateStatusIndicator() {
    // Create the status indicator if it doesn't exist
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'cache_refresher_status';
        statusIndicator.style.position = 'fixed';
        statusIndicator.style.bottom = '10px';
        statusIndicator.style.right = '10px';
        statusIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        statusIndicator.style.color = 'white';
        statusIndicator.style.padding = '5px 10px';
        statusIndicator.style.borderRadius = '5px';
        statusIndicator.style.fontSize = '12px';
        statusIndicator.style.zIndex = '1000';
        statusIndicator.style.display = 'none';
        document.body.appendChild(statusIndicator);
    }

    // Only show the indicator if the extension is active, has refreshes pending, and the indicator is enabled
    if (settings.enabled && refreshesLeft > 0 && settings.showStatusIndicator) {
        let timeString = 'calculating...';

        if (nextRefreshTime) {
            // Calculate time until next refresh
            const timeRemaining = Math.max(0, nextRefreshTime - Date.now());

            // Format time as MM:SS
            const minutes = Math.floor(timeRemaining / 60000);
            const seconds = Math.floor((timeRemaining % 60000) / 1000);
            timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        statusIndicator.textContent = `Cache refreshes: ${refreshesLeft} remaining (${timeString})`;
        statusIndicator.style.display = 'block';

        // Update the timer display every second for a smooth countdown
        if (!statusUpdateInterval) {
            statusUpdateInterval = setInterval(() => {
                updateStatusIndicator();
            }, 1000);
        }
    } else {
        // Hide the indicator when not active
        statusIndicator.style.display = 'none';

        // Clear the update interval when not needed to save resources
        if (statusUpdateInterval) {
            clearInterval(statusUpdateInterval);
            statusUpdateInterval = null;
        }
    }
}

/**
 * Updates the HTML settings panel with current values
 * This ensures the UI always reflects the actual state of the extension
 */
async function updateSettingsPanel() {
    try {
        // Update checkbox states to match current settings
        $('#cache_refresher_enabled').prop('checked', settings.enabled);
        $('#cache_refresher_show_notifications').prop('checked', settings.showNotifications);
        $('#cache_refresher_show_status_indicator').prop('checked', settings.showStatusIndicator);

        // Update number inputs with current values
        // Convert milliseconds to minutes for the interval display
        $('#cache_refresher_max_refreshes').val(settings.maxRefreshes);
        $('#cache_refresher_interval').val(settings.refreshInterval / (60 * 1000));
        $('#cache_refresher_min_tokens').val(settings.maxTokens);

        // Update the status text to show current state
        const statusText = $('#cache_refresher_status_text');
        if (statusText.length) {
            if (settings.enabled) {
                if (refreshInProgress) {
                    statusText.text('Refreshing cache...');
                } else if (refreshesLeft > 0) {
                    statusText.text(`Active - ${refreshesLeft} refreshes remaining`);
                } else {
                    statusText.text('Active - waiting for next generation');
                }
            } else {
                statusText.text('Inactive');
            }
        }

        debugLog('Settings panel updated');
    } catch (error) {
        console.error('Cache Refresher: Error updating settings panel:', error);
    }
}

/**
 * Binds event handlers to the settings panel elements
 * This sets up all the interactive controls in the settings panel
 */
async function bindSettingsHandlers() {
    try {
        debugLog('Binding settings handlers');

        // Enable/disable toggle - main switch for the extension
        $('#cache_refresher_enabled').off('change').on('change', async function() {
            settings.enabled = $(this).prop('checked');
            await saveSettings();

            if (settings.enabled) {
                showNotification('Cache refreshing enabled');
                // Don't start refresh cycle here, wait for a message
                // This prevents unnecessary refreshes when no conversation is active
            } else {
                showNotification('Cache refreshing disabled');
                stopRefreshCycle(); // Stop any active refresh cycle
                // Clear any stored generation data to prevent future refreshes
                lastGenerationData.prompt = null;
                refreshesLeft = 0;
            }

            updateUI();
            updateSettingsPanel();
        });

        // Max refreshes input - controls how many refreshes to perform before stopping
        $('#cache_refresher_max_refreshes').off('change input').on('change input', async function() {
            settings.maxRefreshes = parseInt($(this).val()) || defaultSettings.maxRefreshes;
            await saveSettings();

            // If a refresh cycle is already running, stop and reschedule with new settings
            if (settings.enabled && refreshTimer) {
                stopRefreshCycle();
                scheduleNextRefresh();
            }
        });

        // Refresh interval input - controls time between refreshes (in minutes)
        $('#cache_refresher_interval').off('change input').on('change input', async function() {
            // Convert minutes to milliseconds for internal use
            settings.refreshInterval = (parseFloat($(this).val()) || defaultSettings.refreshInterval / (60 * 1000)) * 60 * 1000;
            await saveSettings();

            // If a refresh cycle is already running, stop and reschedule with new settings
            if (settings.enabled && refreshTimer) {
                stopRefreshCycle();
                scheduleNextRefresh();
            }
        });

        // Min tokens input - controls how many tokens to request in each refresh
        $('#cache_refresher_min_tokens').off('change input').on('change input', async function() {
            settings.maxTokens = parseInt($(this).val()) || defaultSettings.maxTokens;
            await saveSettings();
        });

        // Show notifications toggle - controls whether to show toast notifications
        $('#cache_refresher_show_notifications').off('change').on('change', async function() {
            settings.showNotifications = $(this).prop('checked');
            await saveSettings();
        });
        
        // Show status indicator toggle - controls whether to show the floating status indicator
        $('#cache_refresher_show_status_indicator').off('change').on('change', async function() {
            settings.showStatusIndicator = $(this).prop('checked');
            await saveSettings();
            updateUI(); // Update UI immediately to show/hide the indicator
        });

        debugLog('Settings handlers bound successfully');
    } catch (error) {
        console.error('Cache Refresher: Error binding settings handlers:', error);
    }
}

/**
 * Adds the extension buttons to the UI
 * Currently just initializes the UI state
 */
async function addExtensionControls() {
    // No need to add buttons - the extension will be controlled through the settings panel
    updateUI();
}

/**
 * !!!DEPRECATED!!!
 * Starts the refresh cycle
 * This should only be called internally and not directly from event handlers
 * It begins the process of periodically refreshing the cache
 */
function startRefreshCycle() {
    debugLog('startRefreshCycle:', lastGenerationData);

    // Don't start if we don't have a prompt or if the extension is disabled
    if (!lastGenerationData.prompt || !settings.enabled) return;
    debugLog('startRefreshCycle: pass');

    // Only support chat completion APIs for now
    if (!isChatCompletion()) {
        debugLog('startRefreshCycle: Not a chat completion prompt');
        return;
    }

    // Clear any existing cycle to prevent duplicates
    stopRefreshCycle();

    // Initialize the refresh cycle
    refreshesLeft = settings.maxRefreshes;
    scheduleNextRefresh();
    updateUI();

    debugLog('Refresh cycle started', {
        refreshesLeft,
        interval: settings.refreshInterval,
    });
}

/**
 * Stops the refresh cycle
 * Cleans up all timers and resets state
 */
function stopRefreshCycle() {
    // Clear the refresh timer
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    // Clear the status update interval
    if (statusUpdateInterval) {
        clearInterval(statusUpdateInterval);
        statusUpdateInterval = null;
    }

    // Reset state variables
    nextRefreshTime = null;
    refreshInProgress = false;

    // Update UI to reflect stopped state
    updateUI();

    debugLog('Refresh cycle stopped');
}

/**
 * Schedules the next refresh
 * This sets up a timer to perform the next cache refresh
 */
function scheduleNextRefresh() {
    // Don't schedule if the extension is disabled, no refreshes left, or no prompt
    if (!settings.enabled || refreshesLeft <= 0 || !lastGenerationData.prompt) {
        stopRefreshCycle();
        return;
    }

    // Calculate and store the next refresh time for the countdown display
    nextRefreshTime = Date.now() + settings.refreshInterval;

    // Set up the timer for the next refresh
    refreshTimer = setTimeout(() => {
        refreshCache();
    }, settings.refreshInterval);

    debugLog(`Next refresh scheduled in ${settings.refreshInterval / 1000} seconds`);

    // Update the status indicator immediately to show new time
    updateStatusIndicator();
}

/**
 * Performs a cache refresh by sending a minimal request to the API
 * This keeps the model's context cache warm without generating a full response
 */
async function refreshCache() {
    // Don't refresh if we don't have a prompt or if a refresh is already in progress
    if (!lastGenerationData.prompt || refreshInProgress) return;

    // Set the flag to prevent concurrent refreshes
    refreshInProgress = true;
    updateUI();

    let eventHook = () => { };
    
    try {
        debugLog('Refreshing cache with data', lastGenerationData);

        // Verify we're using a supported API
        if (!isChatCompletion()) {
            throw new Error(`Unsupported API for cache refresh: ${mainApi} in refreshCache()`);
        }

        // Create a truncated version of the conversation history
        const refreshData = {...lastGenerationData};
        if (refreshData.prompt && Array.isArray(refreshData.prompt) && chatCompletionSettings.chat_completion_source === "openrouter") {
            refreshData.prompt = truncateConversationHistory(refreshData.prompt);
            debugLog('Using truncated conversation for refresh', refreshData);
        }

        // Temporarily set max tokens to 1 to minimize token usage
        TempResponseLength.save(mainApi, 1);
        eventHook = TempResponseLength.setupEventHook(mainApi);
        debugLog('Temporarily set response length to 1 token');
        
        // Send a "quiet" request - this tells SillyTavern not to display the response
        // We're just refreshing the cache, not generating visible content
        const data = await sendGenerationRequest('quiet', refreshData);
        debugLog('Cache refresh response:', data);

        // Show notification for successful refresh
        showNotification(`Cache refreshed. ${refreshesLeft - 1} refreshes remaining.`, 'success');

    } catch (error) {
        debugLog('Cache refresh failed', error);
        showNotification(`Cache refresh failed: ${error.message}`, 'error');
    } finally {
        // Always restore the original max tokens value
        if (TempResponseLength.isCustomized()) {
            TempResponseLength.restore(mainApi);
            TempResponseLength.removeEventHook(mainApi, eventHook);
            debugLog('Restored original response length');
        }
        
        // Always clean up, even if there was an error
        refreshInProgress = false;
        refreshesLeft--;
        updateUI();
        scheduleNextRefresh(); // Schedule the next refresh (or stop if no refreshes left)
    }
}

export function cachingAtDepthForClaude(messages, cachingAtDepth) {
    let passedThePrefill = false;
    let depth = 0;
    let previousRoleName = '';

    for (let i = messages.length - 1; i >= 0; i--) {
        if (!passedThePrefill && messages[i].role === 'assistant') {
            continue;
        }

        passedThePrefill = true;

        if (messages[i].role !== previousRoleName) {
            if (depth === cachingAtDepth || depth === cachingAtDepth + 2) {
                const content = messages[i].content;
                content[content.length - 1].cache_control = { type: 'ephemeral' };
            }

            if (depth === cachingAtDepth + 2) {
                break;
            }

            depth += 1;
            previousRoleName = messages[i].role;
        }
    }
}

/**
 * Truncates the conversation history to only include messages up to a certain depth
 * This makes cache refreshes more efficient by focusing only on the most recent and relevant parts
 * 
 * @param {Array} messages - The full conversation history
 * @param {number} cachingDepth - The depth to truncate at (number of role transitions to keep)
 * @returns {Array} - The truncated conversation history
 */
function truncateConversationHistory(messages, cachingDepth) {
    let depth = 0;
    const n_messages = messages.length - 1;
    let index = n_messages;
    let previousRoleName = '';

    if (messages[messages.length - 1].role === 'assistant') {
        depth -= 1;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== previousRoleName) {
            if (depth === cachingDepth + 2) {
                break;
            }
            depth += 1;
            previousRoleName = messages[i].role;
        }
        index -= 1;
    }
    messages.splice(n_messages - depth);
    debugLog(`Truncated conversation from ${n_messages} to ${messages.length} messages at depth ${depth}`);
    return messages;
}

/**
 * Captures generation data for future cache refreshing
 * This is called when a new message is generated to store the prompt for later refreshes
 *
 * @param {Object} data - The generation data from SillyTavern; looks like this '{chat: Array(17), dryRun: true}'
 */
function captureGenerationData(data) {
    // Don't capture if the extension is disabled
    if (!settings.enabled) {
        // Ensure we don't have any stored data if disabled
        if (lastGenerationData.prompt) {
            lastGenerationData.prompt = null;
            debugLog('Extension disabled - cleared stored generation data');
        }
        return;
    }

    debugLog('captureGenerationData', data);
    debugLog('Current API:', mainApi);

    try {
        // Only support chat completion APIs for now
        if (!isChatCompletion()) {
            debugLog('captureGenerationData: Not a chat completion prompt');
            return;
        }

        // Skip dry runs as they're not actual messages
        // Dry runs are used for things like token counting and don't represent actual chat messages
        if (data.dryRun) {
            debugLog('captureGenerationData: Skipping dry run');
            return;
        }

        // Store the chat prompt for future refreshes
        lastGenerationData.prompt = data.chat;
        debugLog('Captured generation data', lastGenerationData);

        //Debuging
        debugLog('captureGenerationData: Example truncation', truncateConversationHistory(lastGenerationData.prompt, cachingAtDepth));

        //Stop refresh cycle on new prompt (work better than GENERATION_STOPPED event)
        stopRefreshCycle();

    } catch (error) {
        debugLog('Error capturing generation data', error);
    }
}

/**
 * Loads the extension CSS
 * This adds the extension's stylesheet to the page
 */
function loadCSS() {
    try {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = `/${extensionFolderPath}/styles.css`;
        document.head.appendChild(link);
        console.log('Cache Refresher: CSS loaded');
        debugLog('CSS loaded');
    } catch (error) {
        console.error('Cache Refresher: Error loading CSS:', error);
    }
}


// Initialize the extension when jQuery is ready
jQuery(async ($) => {
    try {
        debugLog('Starting initialization');

        // Append the settings HTML to the extensions settings panel
        // This loads the HTML template from cache-refresher.html
        $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'cache-refresher'));

        // Load CSS and set up UI
        loadCSS();
        addExtensionControls();

        // Initialize the settings panel with current values
        updateSettingsPanel();

        // Bind event handlers for all interactive elements
        bindSettingsHandlers();

        // Set up event listeners for SillyTavern events
        eventSource.on(eventTypes.APP_READY, () => {
            
            // Listen for chat completion prompts to capture them for refreshing, and cancel the refreshing is successfull
            eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, captureGenerationData);

            // Listen for end of new messages to start the refresh cycle
            eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
                if (settings.enabled && lastGenerationData.prompt) {
                    debugLog('Message received, starting refresh cycle');
                    stopRefreshCycle(); // Clear any existing cycle first
                    refreshesLeft = settings.maxRefreshes;
                    scheduleNextRefresh();
                    updateUI();
                }
            });
            
            // Listen for chat changes to stop the refresh cycle
            // When user switches to a different chat, we don't need to refresh the previous chat anymore
            eventSource.on(eventTypes.CHAT_CHANGED, () => {
                debugLog('Chat changed, stopping refresh cycle');
                stopRefreshCycle();
                lastGenerationData.prompt = null; // Clear the stored prompt
                refreshesLeft = 0;
                updateUI();
            });
        });

        // Make sure we start with clean state if disabled
        if (!settings.enabled) {
            lastGenerationData.prompt = null;
            refreshesLeft = 0;
            debugLog('Extension disabled at startup - ensuring clean state');
        }

        debugLog('Extension initialized');
        console.log(`[${extensionName}] Extension initialized successfully`);
    } catch (error) {
        console.error(`[${extensionName}] Error initializing extension:`, error);
    }
});
