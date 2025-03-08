import { extension_settings } from '../../../extensions.js';
const { eventSource, eventTypes, callGenericPopup, renderExtensionTemplateAsync, sendGenerationRequest, main_api } = SillyTavern.getContext();

// Log extension loading attempt
console.log('Cache Refresher: Loading extension...');

// Extension name and path
const extensionName = 'Cache-Refresh-SillyTavern';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const path = `third-party/${extensionName}`;

// Default configuration
const defaultSettings = {
    enabled: false,
    refreshInterval: (5 * 60 - 30) * 1000, // 4 minutes 30 seconds in milliseconds
    maxRefreshes: 3,
    minTokens: 1, // Minimum tokens to request for cache refresh
    showNotifications: true,
    debug: false,
};

// Initialize extension settings
if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = {};
    console.log('Cache Refresher: Creating new settings object');
}

// Merge with defaults
extension_settings[extensionName] = Object.assign({}, defaultSettings, extension_settings[extensionName]);
const settings = extension_settings[extensionName];
console.log('Cache Refresher: Settings initialized', settings);

// State variables
let lastGenerationData = null;
let refreshTimer = null;
let refreshesLeft = 0;
let refreshInProgress = false;
let statusIndicator = null;

/**
 * Logs a message if debug mode is enabled
 * @param {string} message - Message to log
 * @param {any} data - Optional data to log
 */
function debugLog(message, data) {
    console.log(`[Cache Refresher] ${message}`, data || '');
}

/**
 * Shows a notification if notifications are enabled
 * @param {string} message - Message to show
 * @param {string} type - Notification type (success, info, warning, error)
 */
function showNotification(message, type = 'info') {
    if (settings.showNotifications) {
        toastr[type](message, '', { timeOut: 3000 });
    }
}

/**
 * Check if the prompt is a chat completion
 */
function isChatCompletion() {
    return main_api === 'openai';
}


/**
 * Toggles the cache refresher on/off
 */
async function toggleCacheRefresher() {
    settings.enabled = !settings.enabled;
    await saveSettings();

    if (settings.enabled) {
        if (lastGenerationData) {
            startRefreshCycle();
        }
    } else {
        stopRefreshCycle();
    }

    updateUI();
}

/**
 * Updates the extension settings in localStorage
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
 * Updates the UI elements to reflect current state
 */
function updateUI() {
    const button = document.getElementById('cache_refresher_button');
    const icon = button?.querySelector('i');
    const text = button?.querySelector('span');

    if (button) {
        if (settings.enabled) {
            button.classList.add('active');
            icon.className = refreshInProgress ?
                'fa-solid fa-sync-alt fa-spin' :
                'fa-solid fa-sync-alt';
            text.textContent = 'Cache Refresher: ON';
        } else {
            button.classList.remove('active');
            icon.className = 'fa-solid fa-sync-alt';
            text.textContent = 'Cache Refresher: OFF';
        }
    }

    // Update status indicator
    updateStatusIndicator();
}

/**
 * Creates or updates the status indicator
 */
function updateStatusIndicator() {
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

    if (settings.enabled && refreshesLeft > 0) {
        statusIndicator.textContent = `Cache refreshes: ${refreshesLeft} remaining`;
        statusIndicator.style.display = 'block';
    } else {
        statusIndicator.style.display = 'none';
    }
}

/**
 * Updates the HTML settings panel with current values
 */
async function updateSettingsPanel() {
    try {
        // Update checkbox states
        $('#cache_refresher_enabled').prop('checked', settings.enabled);
        $('#cache_refresher_show_notifications').prop('checked', settings.showNotifications);
        $('#cache_refresher_debug').prop('checked', settings.debug);

        // Update number inputs
        $('#cache_refresher_max_refreshes').val(settings.maxRefreshes);
        $('#cache_refresher_interval').val(settings.refreshInterval / (60 * 1000));
        $('#cache_refresher_min_tokens').val(settings.minTokens);

        // Update status text
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
 */
async function bindSettingsHandlers() {
    try {
        debugLog('Binding settings handlers');

        // Enable/disable toggle
        $('#cache_refresher_enabled').off('change').on('change', async function() {
            settings.enabled = $(this).prop('checked');
            await saveSettings();

            if (settings.enabled) {
                showNotification('Cache refreshing enabled');
                if (lastGenerationData) {
                    startRefreshCycle();
                }
            } else {
                showNotification('Cache refreshing disabled');
                stopRefreshCycle();
            }

            updateUI();
            updateSettingsPanel();
        });

        // Max refreshes input
        $('#cache_refresher_max_refreshes').off('change input').on('change input', async function() {
            settings.maxRefreshes = parseInt($(this).val()) || defaultSettings.maxRefreshes;
            await saveSettings();

            // Restart refresh cycle if enabled and we have data
            if (settings.enabled && lastGenerationData) {
                stopRefreshCycle();
                startRefreshCycle();
            }
        });

        // Refresh interval input
        $('#cache_refresher_interval').off('change input').on('change input', async function() {
            settings.refreshInterval = (parseFloat($(this).val()) || defaultSettings.refreshInterval / (60 * 1000)) * 60 * 1000;
            await saveSettings();

            // Restart refresh cycle if enabled and we have data
            if (settings.enabled && lastGenerationData) {
                stopRefreshCycle();
                startRefreshCycle();
            }
        });

        // Min tokens input
        $('#cache_refresher_min_tokens').off('change input').on('change input', async function() {
            settings.minTokens = parseInt($(this).val()) || defaultSettings.minTokens;
            await saveSettings();
        });

        // Show notifications toggle
        $('#cache_refresher_show_notifications').off('change').on('change', async function() {
            settings.showNotifications = $(this).prop('checked');
            await saveSettings();
        });

        // Debug mode toggle
        $('#cache_refresher_debug').off('change').on('change', async function() {
            settings.debug = $(this).prop('checked');
            await saveSettings();
        });

        debugLog('Settings handlers bound successfully');
    } catch (error) {
        console.error('Cache Refresher: Error binding settings handlers:', error);
    }
}

/**
 * Shows the settings popup (legacy method, kept for compatibility)
 */
async function showSettings() {
    // This function is kept for backward compatibility
    // The settings are now primarily managed through the HTML panel

    const html = `
        <div id="cache_refresher_settings" style="display: flex; flex-direction: column; gap: 10px;">
            <label for="refresh_interval" style="display: flex; justify-content: space-between; align-items: center;">
                <span>${'Refresh Interval (minutes)'}</span>
                <input type="number" id="refresh_interval" min="0.5" max="10" step="0.5" value="${settings.refreshInterval / (60 * 1000)}" style="width: 100px;">
            </label>

            <label for="max_refreshes" style="display: flex; justify-content: space-between; align-items: center;">
                <span>${'Maximum Refreshes'}</span>
                <input type="number" id="max_refreshes" min="1" max="20" value="${settings.maxRefreshes}" style="width: 100px;">
            </label>

            <label for="min_tokens" style="display: flex; justify-content: space-between; align-items: center;">
                <span>${'Minimum Tokens'}</span>
                <input type="number" id="min_tokens" min="1" max="10" value="${settings.minTokens}" style="width: 100px;">
            </label>

            <label style="display: flex; justify-content: space-between; align-items: center;">
                <span>${'Show Notifications'}</span>
                <input type="checkbox" id="show_notifications" ${settings.showNotifications ? 'checked' : ''}>
            </label>

            <label style="display: flex; justify-content: space-between; align-items: center;">
                <span>${'Debug Mode'}</span>
                <input type="checkbox" id="debug_mode" ${settings.debug ? 'checked' : ''}>
            </label>
        </div>
    `;

    const result = await callGenericPopup(html, 2, 'Cache Refresher Settings');

    if (result) {
        settings.refreshInterval = parseFloat(document.getElementById('refresh_interval').value) * 60 * 1000;
        settings.maxRefreshes = parseInt(document.getElementById('max_refreshes').value);
        settings.minTokens = parseInt(document.getElementById('min_tokens').value);
        settings.showNotifications = document.getElementById('show_notifications').checked;
        settings.debug = document.getElementById('debug_mode').checked;

        await saveSettings();
        showNotification('Settings updated');

        // Restart refresh cycle if enabled and we have data
        if (settings.enabled && lastGenerationData) {
            stopRefreshCycle();
            startRefreshCycle();
        }

        // Update the HTML panel
        updateSettingsPanel();
    }
}

/**
 * Adds the extension buttons to the UI
 */
async function addExtensionControls() {
    // Create main button
    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        console.error('Could not find extensions menu');
        return;
    }

    const button = document.createElement('div');
    button.id = 'cache_refresher_button';
    button.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    button.dataset.extensionName = extensionName;
    button.title = 'Toggle cache refreshing to avoid cache expiration';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-sync-alt';

    const text = document.createElement('span');
    text.textContent = 'Cache Refresher: OFF';

    button.appendChild(icon);
    button.appendChild(text);
    button.addEventListener('click', toggleCacheRefresher);

    extensionsMenu.appendChild(button);

    // Create settings button
    const settingsButton = document.createElement('div');
    settingsButton.id = 'cache_refresher_settings_button';
    settingsButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    settingsButton.title = 'Cache Refresher Settings';

    const settingsIcon = document.createElement('i');
    settingsIcon.className = 'fa-solid fa-gear';

    const settingsText = document.createElement('span');
    settingsText.textContent = 'Cache Refresher Settings';

    settingsButton.appendChild(settingsIcon);
    settingsButton.appendChild(settingsText);
    settingsButton.addEventListener('click', showSettings);

    extensionsMenu.appendChild(settingsButton);

    // Initial UI update
    updateUI();
}

/**
 * Starts the refresh cycle
 */
function startRefreshCycle() {
    stopRefreshCycle(); // Clear any existing cycle

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
 */
function stopRefreshCycle() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    refreshInProgress = false;
    updateUI();

    debugLog('Refresh cycle stopped');
}

/**
 * Schedules the next refresh
 */
function scheduleNextRefresh() {
    if (!settings.enabled || refreshesLeft <= 0 || !lastGenerationData) {
        stopRefreshCycle();
        return;
    }

    refreshTimer = setTimeout(() => {
        refreshCache();
    }, settings.refreshInterval);

    debugLog(`Next refresh scheduled in ${settings.refreshInterval / 1000} seconds`);
}

/**
 * Performs a cache refresh by sending the same message as before. (not optimal, could send only the cached part)
 */
async function refreshCache() {
    if (!lastGenerationData || refreshInProgress) return;

    refreshInProgress = true;
    updateUI();

    try {
        debugLog('Refreshing cache with data', lastGenerationData);

        if (lastGenerationData.api !== 'openai') {
            throw new Error(`Unsupported API for cache refresh: ${lastGenerationData.api} in refreshCache()`);
        }

        // Send the new message
        const data = await sendGenerationRequest('api', lastGenerationData);

        if (data.ok) {
            debugLog('Cache refreshed successfully');
            showNotification(`Cache refreshed. ${refreshesLeft - 1} refreshes remaining.`, 'success');
        } else {
            const errorMessage = data?.error?.message || data?.response || 'Unknown error';
            throw new Error(errorMessage);
        }

    } catch (error) {
        debugLog('Cache refresh failed', error);
        showNotification(`Cache refresh failed: ${error.message}`, 'error');
    } finally {
        refreshInProgress = false;
        refreshesLeft--;
        updateUI();
        scheduleNextRefresh();
    }
}

/**
 * Captures generation data for future cache refreshing
 */
function captureGenerationData(data) {
    if (!settings.enabled) return;
    debugLog('captureGenerationData');
    try {
        if (data.dryRun) {
            debugLog('Prompt Inspector: Skipping dry run prompt');
            return;
        }

        if (!isChatCompletion()) {
            debugLog('Prompt Inspector: Not a chat completion prompt');
            return;
        }

        if (!prompt) {
            debugLog('No prompt found in generation data');
            return;
        }

        lastGenerationData = {
            prompt: prompt,
            api: main_api, // Store the API used
        };

        debugLog('Captured generation data', lastGenerationData);

        // Start the refresh cycle
        if (lastGenerationData) {
            startRefreshCycle();
        }
    } catch (error) {
        debugLog('Error capturing generation data', error);
    }
}

/**
 * Loads the extension CSS
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

// Initialize the extension
jQuery(async ($) => {
    try {
        debugLog('Cache Refresher: Starting initialization');

        // Check if eventSource is available
        if (typeof eventSource === 'undefined') {
            console.error('Cache Refresher: eventSource is not available');
            throw new Error('eventSource is not available');
        }

        // Check if eventTypes is available
        if (typeof eventTypes === 'undefined') {
            console.error('Cache Refresher: eventTypes is not available');
            throw new Error('eventTypes is not available');
        }

        // Check if GENERATION_FINISHED event type exists
        if (typeof eventTypes.GENERATION_ENDED === 'undefined') {
            console.error('Cache Refresher: GENERATE_AFTER_DATA event type is not available');
            console.log('Available event types:', Object.keys(eventTypes));
            throw new Error('GENERATE_AFTER_DATA event type is not available');
        }

        // Append the settings HTML to the extensions settings panel
        $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'cache-refresher'));

        loadCSS();
        addExtensionControls();

        // Initialize the settings panel
        updateSettingsPanel();

        // Bind event handlers
        bindSettingsHandlers();

        // Listen for completed generations
        eventSource.on(eventTypes.APP_READY, () => {
            eventSource.on(eventTypes.GENERATION_ENDED, captureGenerationData);
        });

        debugLog('Cache Refresher extension initialized');
        console.log(`[${extensionName}] Extension initialized successfully`);
    } catch (error) {
        console.error(`[${extensionName}] Error initializing extension:`, error);
    }
});
