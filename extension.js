import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ICONS, buildPool, today, truncate} from './quotes.js';

const HISTORY_MAX = 50;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

export default class MotivationQuotes extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._history = [];
        this._histPos = -1;
        this._bag = [];
        this._current = null;
        this._pool = buildPool(this._settings);

        this._buildButton();
        this._restore();
        this._startTimer();

        this._settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._stopTimer();
        this._destroyButton();
        this._settings = null;
        this._history = null;
        this._bag = null;
        this._pool = null;
        this._current = null;
    }

    _onSettingChanged(key) {
        switch (key) {
        case 'current-key':
        case 'current-day':
            break;
        case 'favorites':
            this._syncFavButton();
            if (this._settings.get_string('source') === 'favorites')
                this._reloadPool();
            break;
        case 'source':
        case 'custom-quotes':
            this._reloadPool();
            break;
        case 'order':
            this._bag = [];
            break;
        case 'rotate-mode':
            this._startTimer();
            if (this._settings.get_string('rotate-mode') === 'daily')
                this._showDaily();
            break;
        case 'rotate-minutes':
            this._startTimer();
            break;
        case 'panel-position':
        case 'panel-index':
            this._destroyButton();
            this._buildButton();
            this._render();
            break;
        default:
            this._applyStyle();
            this._render();
        }
    }

    // ---------- quote selection ----------

    _reloadPool() {
        this._pool = buildPool(this._settings);
        this._bag = [];
        const texts = new Set(this._pool.map(x => x.text));
        this._history = this._history.filter(x => texts.has(x.text));
        this._histPos = this._history.findIndex(x => x.text === this._current?.text);
        if (!this._current || !texts.has(this._current.text))
            this._next(false);
        else
            this._render();
    }

    _restore() {
        const s = this._settings;
        const saved = this._pool.find(x => x.text === s.get_string('current-key'));
        if (s.get_string('rotate-mode') === 'daily' && s.get_string('current-day') !== today())
            this._showDaily();
        else if (saved)
            this._show(saved, {animate: false});
        else
            this._next(false);
    }

    _dailyQuote() {
        if (!this._pool.length)
            return null;
        const [y, m, d] = today().split('-').map(Number);
        const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
        return this._pool[(day * 7919) % this._pool.length];
    }

    _showDaily() {
        const q = this._dailyQuote();
        this._show(q, {notify: true});
    }

    _pick() {
        const pool = this._pool;
        if (!pool.length)
            return null;
        if (pool.length === 1)
            return pool[0];
        const cur = this._current?.text;
        if (this._settings.get_string('order') === 'sequential') {
            const i = pool.findIndex(x => x.text === cur);
            return pool[(i + 1) % pool.length];
        }
        // Shuffle bag: every quote once before any repeats.
        const texts = new Set(pool.map(x => x.text));
        this._bag = this._bag.filter(t => texts.has(t) && t !== cur);
        if (!this._bag.length) {
            this._bag = pool.map(x => x.text).filter(t => t !== cur);
            for (let i = this._bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]];
            }
        }
        const t = this._bag.pop();
        return pool.find(x => x.text === t);
    }

    _next(auto = false) {
        if (this._histPos >= 0 && this._histPos < this._history.length - 1) {
            this._histPos++;
            this._show(this._history[this._histPos], {record: false});
            return;
        }
        this._show(this._pick(), {notify: auto});
    }

    _prev() {
        if (this._histPos <= 0)
            return;
        this._histPos--;
        this._show(this._history[this._histPos], {record: false});
    }

    _show(q, {record = true, animate = true, notify = false} = {}) {
        if (q && record) {
            this._history.splice(this._histPos + 1);
            this._history.push(q);
            if (this._history.length > HISTORY_MAX)
                this._history.shift();
            this._histPos = this._history.length - 1;
        }
        this._current = q;
        if (q) {
            this._settings.set_string('current-key', q.text);
            this._settings.set_string('current-day', today());
        }

        if (notify && q && this._settings.get_boolean('notify'))
            Main.notify('Motivation', q.author ? `“${q.text}”\n— ${q.author}` : `“${q.text}”`);

        if (!animate || !this._settings.get_boolean('animate') || !this._label?.mapped) {
            this._render();
            return;
        }
        this._label.remove_all_transitions();
        this._label.ease({
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._label)
                    return;
                this._render();
                this._label.ease({opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_IN_QUAD});
            },
        });
    }

    // ---------- timer ----------

    _startTimer() {
        this._stopTimer();
        const mode = this._settings.get_string('rotate-mode');
        if (mode === 'manual')
            return;
        const secs = mode === 'daily' ? 60 : this._settings.get_uint('rotate-minutes') * 60;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            if (this._settings.get_string('rotate-mode') === 'daily') {
                if (this._settings.get_string('current-day') !== today())
                    this._showDaily();
            } else if (!this._button?.menu.isOpen) {
                this._next(true);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
    }

    // ---------- UI ----------

    _buildButton() {
        this._button = new PanelMenu.Button(0.5, this.metadata.name, false);
        this._label = new St.Label({
            style_class: 'mq-label',
            y_align: Clutter.ActorAlign.CENTER,
            text: '',
        });
        this._button.add_child(this._label);

        this._button.connect('scroll-event', (_a, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP)
                this._prev();
            else if (dir === Clutter.ScrollDirection.DOWN)
                this._next(false);
            return Clutter.EVENT_STOP;
        });

        this._buildMenu();

        const pos = this._settings.get_string('panel-position');
        const box = {left: Main.panel._leftBox, center: Main.panel._centerBox, right: Main.panel._rightBox}[pos];
        const n = box?.get_n_children() ?? 0;
        let index = this._settings.get_int('panel-index');
        if (index < 0 || index > n)
            index = n;
        Main.panel.addToStatusArea(this.uuid, this._button, index, pos);

        this._applyStyle();
    }

    _buildMenu() {
        const menu = this._button.menu;

        // Added straight to the menu box (not as a menu item) so the shell
        // doesn't render it in the greyed-out "insensitive" style.
        const box = new St.BoxLayout({
            style_class: 'mq-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._menuQuote = new St.Label({style_class: 'mq-quote', x_expand: true});
        const ct = this._menuQuote.clutter_text;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        ct.ellipsize = Pango.EllipsizeMode.NONE;
        this._menuAuthor = new St.Label({style_class: 'mq-author', x_align: Clutter.ActorAlign.END});
        box.add_child(this._menuQuote);
        box.add_child(this._menuAuthor);
        menu.box.add_child(box);

        const actions = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const row = new St.BoxLayout({style_class: 'mq-actions', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        const mk = (icon, name, cb) => {
            const b = new St.Button({
                style_class: 'button mq-btn',
                can_focus: true,
                accessible_name: name,
                child: new St.Icon({icon_name: icon, icon_size: 16}),
            });
            b.connect('clicked', cb);
            row.add_child(b);
            return b;
        };
        this._prevBtn = mk('go-previous-symbolic', 'Previous quote', () => this._prev());
        this._favBtn = mk('non-starred-symbolic', 'Star this quote', () => this._toggleFav());
        this._copyBtn = mk('edit-copy-symbolic', 'Copy quote', () => this._copy());
        mk('go-next-symbolic', 'Next quote', () => this._next(false));
        actions.add_child(row);
        menu.addMenuItem(actions);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Settings…', () => this.openPreferences());

        menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._renderMenu();
        });
    }

    _destroyButton() {
        this._button?.destroy();
        this._button = null;
        this._label = null;
        this._menuQuote = this._menuAuthor = null;
        this._favBtn = this._prevBtn = this._copyBtn = null;
        if (this._copyResetId)
            GLib.source_remove(this._copyResetId);
        this._copyResetId = 0;
    }

    _applyStyle() {
        if (!this._label)
            return;
        const s = this._settings;
        const css = [];
        if (s.get_boolean('italic'))
            css.push('font-style: italic;');
        const color = s.get_string('text-color');
        if (s.get_boolean('use-custom-color') && COLOR_RE.test(color))
            css.push(`color: ${color};`);
        this._label.style = css.join(' ') || null;
    }

    _render() {
        if (!this._label)
            return;
        const s = this._settings;
        const q = this._current;
        const icon = ICONS[s.get_string('icon')] ?? '';
        let text;
        if (!q) {
            text = s.get_string('source') === 'favorites'
                ? 'Star some quotes to see them here'
                : 'Add your own quotes in Settings';
        } else {
            text = truncate(q.text, s.get_uint('max-length'));
            if (s.get_boolean('quote-marks'))
                text = `“${text}”`;
            if (s.get_boolean('show-author') && q.author)
                text += `  — ${q.author}`;
        }
        this._label.text = icon ? `${icon}  ${text}` : text;
        if (this._button?.menu.isOpen)
            this._renderMenu();
    }

    _renderMenu() {
        if (!this._menuQuote)
            return;
        const q = this._current;
        this._menuQuote.text = q ? `“${q.text}”` : 'No quotes yet. Open Settings to add your own.';
        this._menuAuthor.text = q?.author ? `— ${q.author}` : '';
        this._menuAuthor.visible = !!q?.author;
        this._prevBtn.reactive = this._histPos > 0;
        this._prevBtn.opacity = this._histPos > 0 ? 255 : 100;
        this._syncFavButton();
    }

    _isFav() {
        return !!this._current && this._settings.get_strv('favorites').includes(this._current.text);
    }

    _syncFavButton() {
        if (!this._favBtn)
            return;
        const fav = this._isFav();
        this._favBtn.child.icon_name = fav ? 'starred-symbolic' : 'non-starred-symbolic';
        this._favBtn.accessible_name = fav ? 'Unstar this quote' : 'Star this quote';
        if (fav)
            this._favBtn.add_style_class_name('mq-starred');
        else
            this._favBtn.remove_style_class_name('mq-starred');
    }

    _toggleFav() {
        if (!this._current)
            return;
        const t = this._current.text;
        const favs = this._settings.get_strv('favorites');
        const i = favs.indexOf(t);
        if (i >= 0)
            favs.splice(i, 1);
        else
            favs.push(t);
        this._settings.set_strv('favorites', favs);
    }

    _copy() {
        const q = this._current;
        if (!q)
            return;
        const text = q.author ? `“${q.text}” — ${q.author}` : `“${q.text}”`;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        // Brief checkmark as feedback.
        const icon = this._copyBtn.child;
        icon.icon_name = 'object-select-symbolic';
        if (this._copyResetId)
            GLib.source_remove(this._copyResetId);
        this._copyResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            this._copyResetId = 0;
            if (this._copyBtn)
                this._copyBtn.child.icon_name = 'edit-copy-symbolic';
            return GLib.SOURCE_REMOVE;
        });
    }
}
