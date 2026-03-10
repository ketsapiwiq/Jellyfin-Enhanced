// /js/enhanced/translations.js
(function(JE) {
    'use strict';

    const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/n00bcodr/Jellyfin-Enhanced/main/Jellyfin.Plugin.JellyfinEnhanced/js/locales';
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    function normalizeLangCode(code) {
        if (!code) return code;
        const parts = code.split('-');
        if (parts.length === 1) return parts[0].toLowerCase();
        if (parts.length === 2) return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
        return code;
    }

    function buildLanguageChain(primaryLang) {
        const normalizedLang = normalizeLangCode(primaryLang);
        const langCodes = [];

        if (normalizedLang) {
            langCodes.push(normalizedLang);
        }

        if (normalizedLang && normalizedLang.includes('-')) {
            const baseLang = normalizedLang.split('-')[0];
            if (!langCodes.includes(baseLang)) {
                langCodes.push(baseLang);
            }
        }

        if (langCodes[langCodes.length - 1] !== 'en') {
            langCodes.push('en');
        }

        return Array.from(new Set(langCodes.filter(Boolean)));
    }

    async function getPluginVersion() {
        let pluginVersion = JE?.pluginVersion;
        if (pluginVersion && pluginVersion !== 'unknown') return pluginVersion;

        try {
            const versionResponse = await fetch(ApiClient.getUrl('/JellyfinEnhanced/version'));
            if (versionResponse.ok) {
                pluginVersion = await versionResponse.text();
                if (JE) {
                    JE.pluginVersion = pluginVersion;
                }
                return pluginVersion;
            }
        } catch (e) {
            console.warn('🪼 Jellyfin Enhanced: Failed to fetch plugin version', e);
        }

        return 'unknown';
    }

    function cleanOldTranslationCache(pluginVersion) {
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('JE_translation_') || key.startsWith('JE_translation_ts_'))) {
                    if (!key.includes(`_${pluginVersion}`)) {
                        localStorage.removeItem(key);
                        console.log(`🪼 Jellyfin Enhanced: Removed old translation cache: ${key}`);
                    }
                }
            }
        } catch (e) {
            console.warn('🪼 Jellyfin Enhanced: Failed to clean up old translation caches', e);
        }
    }

    /**
     * Fetches translations from GitHub in the background and applies them when ready.
     * Non-blocking: returns immediately, updates translations asynchronously.
     */
    function fetchFromGitHubAsync(code, pluginVersion, cacheKey, timestampKey) {
        fetch(`${GITHUB_RAW_BASE}/${code}.json`, {
            method: 'GET',
            cache: 'no-cache',
            headers: { 'Accept': 'application/json' }
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            // If language not found, try English from GitHub
            if (response.status === 404 && code !== 'en') {
                return fetch(`${GITHUB_RAW_BASE}/en.json`, {
                    method: 'GET',
                    cache: 'no-cache',
                    headers: { 'Accept': 'application/json' }
                }).then(enRes => enRes.ok ? enRes.json() : null);
            }
            return null;
        })
        .then(translations => {
            if (translations && typeof translations === 'object' && Object.keys(translations).length > 0) {
                // Update the global translations
                Object.assign(JE.translations, translations);
                JE.t = window.JellyfinEnhanced.t; // Refresh the t() function reference
                console.log(`🪼 Jellyfin Enhanced: Applied GitHub translations for ${code} in background`);
                
                // Cache for future use
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(translations));
                    localStorage.setItem(timestampKey, Date.now().toString());
                } catch (e) { /* ignore storage errors */ }
            }
        })
        .catch(err => {
            console.debug('🪼 Jellyfin Enhanced: Background GitHub fetch failed (non-critical):', err.message);
        });
    }

    async function tryLoadSingleLanguage(code, pluginVersion) {
        const cacheKey = `JE_translation_${code}_${pluginVersion}`;
        const timestampKey = `JE_translation_ts_${code}_${pluginVersion}`;
        const cachedTranslations = localStorage.getItem(cacheKey);
        const cachedTimestamp = localStorage.getItem(timestampKey);

        if (cachedTranslations && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_DURATION) {
                console.log(`🪼 Jellyfin Enhanced: Using cached translations for ${code} (age: ${Math.round(age / 1000 / 60)} minutes, version: ${pluginVersion})`);
                try {
                    return { translations: JSON.parse(cachedTranslations), usedLang: code };
                } catch (e) {
                    console.warn('🪼 Jellyfin Enhanced: Failed to parse cached translations, will fetch fresh', e);
                }
            }
        }

        // Try bundled translations first (local server, fast)
        console.log(`🪼 Jellyfin Enhanced: Loading bundled translations for ${code}...`);
        try {
            const bundledResponse = await fetch(ApiClient.getUrl(`/JellyfinEnhanced/locales/${code}.json`));
            if (bundledResponse.ok) {
                const translations = await bundledResponse.json();
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(translations));
                    localStorage.setItem(timestampKey, Date.now().toString());
                    console.log(`🪼 Jellyfin Enhanced: Successfully loaded and cached bundled translations for ${code} (version: ${pluginVersion})`);
                } catch (e) { /* ignore */ }
                
                // Trigger background GitHub fetch to update translations for next load
                // This is non-blocking and doesn't affect current load time
                fetchFromGitHubAsync(code, pluginVersion, cacheKey, timestampKey);
                
                return { translations, usedLang: code };
            }
        } catch (bundledError) {
            console.warn('🪼 Jellyfin Enhanced: Bundled translations unavailable, trying GitHub in background:', bundledError.message);
        }

        // Bundled failed - start GitHub fetch in background and return empty translations immediately
        // This ensures the plugin loads without blocking on external network requests
        fetchFromGitHubAsync(code, pluginVersion, cacheKey, timestampKey);

        // Fall back to bundled English as immediate fallback
        try {
            const englishResponse = await fetch(ApiClient.getUrl('/JellyfinEnhanced/locales/en.json'));
            if (englishResponse.ok) {
                const translations = await englishResponse.json();
                console.log(`🪼 Jellyfin Enhanced: Using English fallback while GitHub fetches ${code} in background`);
                return { translations, usedLang: 'en' };
            }
        } catch (e) {
            console.warn('🪼 Jellyfin Enhanced: English fallback also failed:', e.message);
        }

        // Return empty - UI will use translation keys as fallback text
        return { translations: {}, usedLang: code };
    }

    JE.loadTranslations = async function() {
        try {
            const pluginVersion = await getPluginVersion();

            let user = ApiClient.getCurrentUser ? ApiClient.getCurrentUser() : null;
            if (user instanceof Promise) {
                user = await user;
            }

            const userId = user?.Id;
            let lang = 'en';
            if (userId) {
                const storageKey = `${userId}-language`;
                const storedLang = localStorage.getItem(storageKey);
                if (storedLang) {
                    lang = normalizeLangCode(storedLang);
                }
            }

            cleanOldTranslationCache(pluginVersion);

            const langCodes = buildLanguageChain(lang);
            for (const code of langCodes) {
                try {
                    const result = await tryLoadSingleLanguage(code, pluginVersion);
                    if (result && result.translations) {
                        return result.translations;
                    }
                } catch (e) {
                    console.warn(`🪼 Jellyfin Enhanced: Failed to load translations for ${code}`, e);
                }
            }

            console.error('🪼 Jellyfin Enhanced: Failed to load translations from any source');
            return {};
        } catch (error) {
            console.error('🪼 Jellyfin Enhanced: Failed to load translations:', error);
            return {};
        }
    };
})(window.JellyfinEnhanced);
