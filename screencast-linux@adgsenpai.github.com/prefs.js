import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ScreenCastPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('Screen Cast'),
            icon_name: 'phone-symbolic',
        });
        window.add(page);

        // Connection
        const conn = new Adw.PreferencesGroup({
            title: _('Connection'),
            description: _('Enable Developer options → USB debugging on your phone first.'),
        });
        page.add(conn);

        const modes = ['usb', 'wifi'];
        const modeRow = new Adw.ComboRow({
            title: _('Connect Via'),
            model: Gtk.StringList.new([_('USB cable'), _('Wi-Fi (wireless ADB)')]),
            selected: Math.max(0, modes.indexOf(settings.get_string('connection-mode'))),
        });
        modeRow.connect('notify::selected', () =>
            settings.set_string('connection-mode', modes[modeRow.selected]));
        settings.connect('changed::connection-mode', () => {
            modeRow.selected = Math.max(0, modes.indexOf(settings.get_string('connection-mode')));
        });
        conn.add(modeRow);

        const addrRow = new Adw.EntryRow({title: _('Phone IP Address (e.g. 192.168.1.42)')});
        settings.bind('wifi-address', addrRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        conn.add(addrRow);

        const portRow = Adw.SpinRow.new_with_range(1, 65535, 1);
        portRow.title = _('Wireless ADB Port');
        settings.bind('wifi-port', portRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        conn.add(portRow);

        // Video
        const video = new Adw.PreferencesGroup({title: _('Video')});
        page.add(video);

        const sizeRow = Adw.SpinRow.new_with_range(0, 4096, 64);
        sizeRow.title = _('Maximum Resolution');
        sizeRow.subtitle = _('Longest side in pixels, 0 = native. Lower values help on slow Wi-Fi.');
        settings.bind('max-size', sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        video.add(sizeRow);

        const rateRow = Adw.SpinRow.new_with_range(1, 100, 1);
        rateRow.title = _('Bit Rate (Mbps)');
        settings.bind('bit-rate', rateRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        video.add(rateRow);

        // Behaviour
        const behaviour = new Adw.PreferencesGroup({title: _('Behaviour')});
        page.add(behaviour);
        for (const [key, title, subtitle] of [
            ['turn-screen-off', _('Turn Phone Screen Off'), _('Saves battery; the mirror keeps working')],
            ['stay-awake', _('Keep Phone Awake'), _('Only while plugged in')],
            ['audio', _('Forward Audio'), _('Requires scrcpy 2.0 and Android 11+')],
            ['fullscreen', _('Start Fullscreen'), null],
            ['record', _('Record to Videos Folder'), _('Saves an .mp4 of each session')],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            behaviour.add(row);
        }

        // Advanced
        const advanced = new Adw.PreferencesGroup({title: _('Advanced')});
        page.add(advanced);

        for (const [key, title] of [
            ['scrcpy-path', _('Custom scrcpy Path')],
            ['adb-path', _('Custom adb Path')],
            ['extra-args', _('Extra scrcpy Arguments')],
        ]) {
            const row = new Adw.EntryRow({title});
            settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
            advanced.add(row);
        }
    }
}
