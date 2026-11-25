// Shared by extension.js and prefs.js — must not import Shell or GTK modules.

export const ICONS = {
    none: '',
    spark: '✦',
    star: '★',
    diamond: '◆',
    dot: '•',
    chevron: '›',
};

export function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadCustom(settings) {
    try {
        const v = JSON.parse(settings.get_string('custom-quotes') || '[]');
        if (!Array.isArray(v))
            return [];
        return v
            .filter(x => x && typeof x.text === 'string' && x.text.trim())
            .map(x => ({text: x.text.trim(), author: String(x.author ?? '').trim()}));
    } catch {
        return [];
    }
}

export function saveCustom(settings, list) {
    settings.set_string('custom-quotes', JSON.stringify(list.map(({text, author}) => ({text, author}))));
}

/** The quotes currently eligible to be shown: your own, or only the starred ones. */
export function buildPool(settings) {
    const all = loadCustom(settings);
    if (settings.get_string('source') === 'favorites') {
        const fav = new Set(settings.get_strv('favorites'));
        return all.filter(x => fav.has(x.text));
    }
    return all;
}

/** Shorten at a word boundary and add an ellipsis. */
export function truncate(text, max) {
    if (!max || text.length <= max)
        return text;
    let cut = text.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    if (sp > max * 0.6)
        cut = cut.slice(0, sp);
    return `${cut.replace(/[\s,;:.—–-]+$/, '')}…`;
}
