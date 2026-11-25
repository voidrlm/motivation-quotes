import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ICONS, buildPool, loadCustom, saveCustom, truncate} from './quotes.js';

const SOURCES = [['all', 'All my quotes'], ['favorites', 'Starred quotes only']];
const MODES = [['interval', 'Every few minutes'], ['daily', 'Once a day (quote of the day)'], ['manual', 'Only when I scroll or click']];
const ORDERS = [['random', 'Shuffle'], ['sequential', 'In order']];
const ICON_CHOICES = [
    ['none', 'None'], ['spark', `${ICONS.spark}  Spark`], ['star', `${ICONS.star}  Star`],
    ['diamond', `${ICONS.diamond}  Diamond`], ['dot', `${ICONS.dot}  Dot`], ['chevron', `${ICONS.chevron}  Chevron`],
];
const POSITIONS = [['left', 'Left'], ['center', 'Center (next to the clock)'], ['right', 'Right']];

export default class MotivationQuotesPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        window.set_default_size(640, 780);
        window.search_enabled = true;

        window.add(this._quotesPage());
        window.add(this._lookPage());
    }

    // ---------- Quotes page ----------

    _quotesPage() {
        const s = this._settings;
        const page = new Adw.PreferencesPage({title: 'Quotes', icon_name: 'view-list-symbolic'});

        const source = new Adw.PreferencesGroup();
        source.add(this._combo('source', 'Show quotes from', SOURCES));
        const count = new Adw.ActionRow({title: 'Quotes in rotation'});
        const countLabel = new Gtk.Label({css_classes: ['dim-label']});
        count.add_suffix(countLabel);
        source.add(count);
        const syncCount = () => {
            countLabel.label = String(buildPool(s).length);
        };
        for (const k of ['source', 'custom-quotes', 'favorites'])
            s.connect(`changed::${k}`, syncCount);
        syncCount();
        page.add(source);

        // My quotes
        page.add(this._customGroup());

        // Starred
        page.add(this._favGroup());

        return page;
    }

    _customGroup() {
        const s = this._settings;
        const group = new Adw.PreferencesGroup({
            title: 'My quotes',
            description: 'The quotes shown in the top bar.',
        });
        const text = new Adw.EntryRow({title: 'Quote', use_markup: false});
        const author = new Adw.EntryRow({title: 'Author (optional)', use_markup: false});
        const status = new Gtk.Label({css_classes: ['dim-label'], xalign: 0, wrap: true});
        const add = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        const addRow = new Adw.ActionRow();
        addRow.add_prefix(status);
        addRow.add_suffix(add);
        group.add(text);
        group.add(author);
        group.add(addRow);

        const submit = () => {
            const t = text.text.trim().replace(/^["“”']+|["“”']+$/g, '').trim();
            if (!t) {
                status.label = 'Type a quote first.';
                return;
            }
            if (loadCustom(s).some(x => x.text.toLowerCase() === t.toLowerCase())) {
                status.label = 'That quote is already in the list.';
                return;
            }
            const list = loadCustom(s);
            list.push({text: t, author: author.text.trim()});
            saveCustom(s, list);
            text.text = author.text = '';
            status.label = 'Added.';
        };
        add.connect('clicked', submit);
        text.connect('entry-activated', submit);
        author.connect('entry-activated', submit);

        let rows = [];
        const rebuild = () => {
            for (const r of rows)
                group.remove(r);
            rows = [];
            loadCustom(s).forEach((x, i) => {
                const row = new Adw.ActionRow({
                    title: x.text,
                    subtitle: x.author || 'No author',
                    use_markup: false,
                });
                const del = new Gtk.Button({
                    icon_name: 'user-trash-symbolic', tooltip_text: 'Remove',
                    valign: Gtk.Align.CENTER, css_classes: ['flat', 'error'],
                });
                del.connect('clicked', () => {
                    const list = loadCustom(s);
                    list.splice(i, 1);
                    saveCustom(s, list);
                    s.set_strv('favorites', s.get_strv('favorites').filter(f => f !== x.text));
                });
                row.add_suffix(del);
                group.add(row);
                rows.push(row);
            });
        };
        s.connect('changed::custom-quotes', rebuild);
        rebuild();
        return group;
    }

    _favGroup() {
        const s = this._settings;
        const group = new Adw.PreferencesGroup({
            title: 'Starred',
            description: 'Star a quote from the top-bar menu to keep it here.',
        });
        let rows = [];
        const rebuild = () => {
            for (const r of rows)
                group.remove(r);
            rows = [];
            const all = loadCustom(s);
            const favs = s.get_strv('favorites');
            if (!favs.length) {
                const empty = new Adw.ActionRow({title: 'Nothing starred yet', css_classes: ['dim-label']});
                group.add(empty);
                rows.push(empty);
                return;
            }
            for (const t of favs) {
                const quote = all.find(x => x.text === t);
                const row = new Adw.ActionRow({
                    title: truncate(t, 140),
                    subtitle: quote?.author || '',
                    use_markup: false,
                });
                const del = new Gtk.Button({
                    icon_name: 'starred-symbolic', tooltip_text: 'Unstar',
                    valign: Gtk.Align.CENTER, css_classes: ['flat'],
                });
                del.connect('clicked', () => s.set_strv('favorites', s.get_strv('favorites').filter(f => f !== t)));
                row.add_suffix(del);
                group.add(row);
                rows.push(row);
            }
        };
        s.connect('changed::favorites', rebuild);
        s.connect('changed::custom-quotes', rebuild);
        rebuild();
        return group;
    }

    // ---------- Look & rotation page ----------

    _lookPage() {
        const s = this._settings;
        const page = new Adw.PreferencesPage({title: 'Display', icon_name: 'preferences-desktop-display-symbolic'});

        const rotation = new Adw.PreferencesGroup({title: 'Rotation', description: 'Scroll over the quote to change it any time.'});
        rotation.add(this._combo('rotate-mode', 'Change quote', MODES));
        const minutes = this._spin('rotate-minutes', 'Minutes per quote', '', 1, 1440);
        rotation.add(minutes);
        rotation.add(this._combo('order', 'Order', ORDERS));
        rotation.add(this._switch('animate', 'Fade between quotes'));
        rotation.add(this._switch('notify', 'Notify on new quote', 'Also pop up a notification when the quote changes on its own'));
        const syncMode = () => {
            minutes.sensitive = s.get_string('rotate-mode') === 'interval';
        };
        s.connect('changed::rotate-mode', syncMode);
        syncMode();
        page.add(rotation);

        const look = new Adw.PreferencesGroup({title: 'Top bar text'});
        look.add(this._combo('icon', 'Symbol', ICON_CHOICES));
        look.add(this._switch('quote-marks', 'Quotation marks', '“Like this”'));
        look.add(this._switch('show-author', 'Show author', 'The author is always shown in the menu'));
        look.add(this._switch('italic', 'Italic'));
        look.add(this._spin('max-length', 'Maximum length', 'Longer quotes are shortened with “…” (0 = never). Click for the full quote.', 0, 300));
        look.add(this._switch('use-custom-color', 'Custom color'));
        const color = this._color('text-color', 'Text color');
        look.add(color);
        const syncColor = () => {
            color.sensitive = s.get_boolean('use-custom-color');
        };
        s.connect('changed::use-custom-color', syncColor);
        syncColor();
        page.add(look);

        const panel = new Adw.PreferencesGroup({title: 'Position'});
        panel.add(this._combo('panel-position', 'Panel area', POSITIONS));
        panel.add(this._spin('panel-index', 'Order in that area', '0 = first, −1 = last', -1, 20, true));
        page.add(panel);

        const resetGroup = new Adw.PreferencesGroup();
        const resetBtn = new Gtk.Button({label: 'Reset display settings', halign: Gtk.Align.CENTER, css_classes: ['pill']});
        resetBtn.connect('clicked', () => {
            const keep = new Set(['custom-quotes', 'favorites', 'source', 'current-key', 'current-day']);
            for (const key of s.settings_schema.list_keys()) {
                if (!keep.has(key))
                    s.reset(key);
            }
        });
        resetGroup.add(resetBtn);
        page.add(resetGroup);
        return page;
    }

    // ---------- helpers ----------

    _switch(key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', 0);
        return row;
    }

    _spin(key, title, subtitle, min, max, signed = false) {
        const s = this._settings;
        const get = () => (signed ? s.get_int(key) : s.get_uint(key));
        const row = Adw.SpinRow.new_with_range(min, max, 1);
        row.title = title;
        row.subtitle = subtitle;
        row.value = get();
        row.connect('notify::value', () => {
            const v = Math.round(row.value);
            if (v !== get())
                signed ? s.set_int(key, v) : s.set_uint(key, v);
        });
        s.connect(`changed::${key}`, () => {
            if (Math.round(row.value) !== get())
                row.value = get();
        });
        return row;
    }

    _combo(key, title, options) {
        const s = this._settings;
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(options.map(o => o[1]))});
        const sync = () => {
            const i = options.findIndex(o => o[0] === s.get_string(key));
            if (i >= 0 && row.selected !== i)
                row.selected = i;
        };
        sync();
        row.connect('notify::selected', () => {
            const v = options[row.selected]?.[0];
            if (v !== undefined && v !== s.get_string(key))
                s.set_string(key, v);
        });
        s.connect(`changed::${key}`, sync);
        return row;
    }

    _color(key, title) {
        const s = this._settings;
        const row = new Adw.ActionRow({title});
        const btn = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const sync = () => {
            const c = new Gdk.RGBA();
            if (c.parse(s.get_string(key)))
                btn.rgba = c;
        };
        sync();
        btn.connect('notify::rgba', () => {
            const c = btn.rgba;
            const hex = '#' + [c.red, c.green, c.blue]
                .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
            if (hex !== s.get_string(key))
                s.set_string(key, hex);
        });
        s.connect(`changed::${key}`, sync);
        row.add_suffix(btn);
        row.activatable_widget = btn;
        return row;
    }
}
