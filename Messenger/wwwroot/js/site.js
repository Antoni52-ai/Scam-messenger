(() => {
    const THEME_STORAGE_KEY = 'nova-theme';
    const DARK_THEME = 'dark';
    const LIGHT_THEME = 'light';

    let hasManualOverride = false;
    const systemMedia = window.matchMedia('(prefers-color-scheme: dark)');

    function normalizeTheme(theme) {
        return theme === DARK_THEME || theme === LIGHT_THEME ? theme : null;
    }

    function getStoredTheme() {
        try {
            return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
        } catch {
            return null;
        }
    }

    function getSystemTheme() {
        return systemMedia.matches ? DARK_THEME : LIGHT_THEME;
    }

    function updateToggleLabel(theme) {
        const textNode = document.getElementById('themeToggleText');
        if (textNode) {
            textNode.textContent = theme === DARK_THEME ? 'Светлая тема' : 'Тёмная тема';
        }

        const button = document.getElementById('themeToggleBtn');
        if (button) {
            button.setAttribute('aria-pressed', theme === DARK_THEME ? 'true' : 'false');
            button.title = theme === DARK_THEME ? 'Включить светлую тему' : 'Включить тёмную тему';
        }
    }

    function applyTheme(theme) {
        const normalized = normalizeTheme(theme) ?? getSystemTheme();
        document.documentElement.setAttribute('data-theme', normalized);
        updateToggleLabel(normalized);
    }

    function saveTheme(theme) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // ignore storage errors
        }
    }

    function setTheme(theme, persist = false) {
        applyTheme(theme);
        if (persist) {
            hasManualOverride = true;
            saveTheme(theme);
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
        const next = current === DARK_THEME ? LIGHT_THEME : DARK_THEME;
        setTheme(next, true);
    }

    function handleSystemChange() {
        if (hasManualOverride) {
            return;
        }

        applyTheme(getSystemTheme());
    }

    function initTheme() {
        const storedTheme = getStoredTheme();
        hasManualOverride = Boolean(storedTheme);

        if (storedTheme) {
            applyTheme(storedTheme);
        } else {
            applyTheme(getSystemTheme());
        }

        const toggleButton = document.getElementById('themeToggleBtn');
        if (toggleButton) {
            toggleButton.addEventListener('click', toggleTheme);
        }

        if (typeof systemMedia.addEventListener === 'function') {
            systemMedia.addEventListener('change', handleSystemChange);
        } else if (typeof systemMedia.addListener === 'function') {
            systemMedia.addListener(handleSystemChange);
        }
    }

    document.addEventListener('DOMContentLoaded', initTheme);

    window.novaTheme = {
        initTheme,
        setTheme,
        toggleTheme
    };
})();
