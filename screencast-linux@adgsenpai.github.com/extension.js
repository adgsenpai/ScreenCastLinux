// ScreenCast Linux — mirror an Android phone from GNOME Quick Settings using scrcpy.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const IPV4_SRC_RE = /\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})/;
const IPV4_INET_RE = /\binet\s+(\d{1,3}(?:\.\d{1,3}){3})/;
const MAX_LOG_LINES = 20;

/** Run a command and collect its output. Never throws for non-zero exit. */
function runCommand(argv, cancellable = null) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                resolve({ok: p.get_successful(), out: (stdout ?? '').trim()});
            } catch (e) {
                reject(e);
            }
        });
    });
}

function wait(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

const ScreenCastToggle = GObject.registerClass(
class ScreenCastToggle extends QuickMenuToggle {
    constructor(extension, gicon) {
        super({
            title: _('Screen Cast'),
            gicon,
            toggleMode: false,
        });

        this._extension = extension;
        this._settings = extension.getSettings();
        this._proc = null;
        this._cancellable = new Gio.Cancellable();
        this._log = [];
        this._scrcpyMajor = null;
        this._busy = false;
        this._stoppedProc = null;

        this.menu.setHeader(gicon, _('Screen Cast'), _('Android mirroring via scrcpy'));

        // Connection mode
        this._modeSection = new PopupMenu.PopupMenuSection();
        this._usbItem = this._modeSection.addAction(_('USB cable'),
            () => this._settings.set_string('connection-mode', 'usb'));
        this._wifiItem = this._modeSection.addAction(_('Wi-Fi (wireless ADB)'),
            () => this._settings.set_string('connection-mode', 'wifi'));
        this._addressItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._modeSection.addMenuItem(this._addressItem);
        this._setupWifiItem = this._modeSection.addAction(_('Set Up Wi-Fi From USB…'),
            () => this._setupWireless().catch(logError));
        this.menu.addMenuItem(this._modeSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Options
        this._addSwitch(_('Turn Phone Screen Off'), 'turn-screen-off');
        this._addSwitch(_('Keep Phone Awake'), 'stay-awake');
        this._addSwitch(_('Forward Audio'), 'audio');
        this._addSwitch(_('Fullscreen'), 'fullscreen');
        this._addSwitch(_('Record to Videos'), 'record');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Screen Cast Settings'), () => this._extension.openPreferences());

        this.connect('clicked', () => this._toggle());
        this._settings.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    _addSwitch(label, key) {
        const item = new PopupMenu.PopupSwitchMenuItem(label, this._settings.get_boolean(key));
        item.connect('toggled', (_item, state) => this._settings.set_boolean(key, state));
        this._settings.connectObject(`changed::${key}`,
            () => item.setToggleState(this._settings.get_boolean(key)), item);
        this.menu.addMenuItem(item);
    }

    get running() {
        return this._proc !== null;
    }

    _wifiTarget() {
        const addr = this._settings.get_string('wifi-address').trim();
        if (!addr)
            return null;
        // Allow "ip:port" in the address field (e.g. from Android 11+ wireless debugging).
        if (addr.includes(':'))
            return addr;
        return `${addr}:${this._settings.get_int('wifi-port')}`;
    }

    _sync() {
        const mode = this._settings.get_string('connection-mode');
        const target = this._wifiTarget();

        this._usbItem.setOrnament(mode === 'usb' ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this._wifiItem.setOrnament(mode === 'wifi' ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this._addressItem.label.text = target
            ? _('Phone address: %s').format(target)
            : _('No Wi-Fi phone set up yet');
        this._addressItem.visible = mode === 'wifi';
        this._usbItem.reactive = !this.running;
        this._wifiItem.reactive = !this.running;
        this._setupWifiItem.reactive = !this.running && !this._busy;
        this._setupWifiItem.label.text = this._busy ? _('Setting Up Wi-Fi…') : _('Set Up Wi-Fi From USB…');

        const modeLabel = mode === 'wifi' ? _('Wi-Fi') : _('USB');
        this.checked = this.running;
        this.subtitle = this.running ? _('Casting · %s').format(modeLabel) : modeLabel;
    }

    _findProgram(key, name) {
        const custom = this._settings.get_string(key).trim();
        if (custom)
            return GLib.file_test(custom, GLib.FileTest.IS_EXECUTABLE) ? custom : null;
        return GLib.find_program_in_path(name);
    }

    async _scrcpyMajorVersion(scrcpy) {
        if (this._scrcpyMajor !== null)
            return this._scrcpyMajor;
        try {
            const {out} = await runCommand([scrcpy, '--version'], this._cancellable);
            const m = out.match(/scrcpy\s+v?(\d+)\./);
            this._scrcpyMajor = m ? parseInt(m[1]) : 2;
        } catch (e) {
            this._scrcpyMajor = 2;
        }
        return this._scrcpyMajor;
    }

    _toggle() {
        if (this.running)
            this._stop();
        else
            this._start().catch(e => this._notify(_('Could not start screen cast'), e.message));
    }

    async _start() {
        const scrcpy = this._findProgram('scrcpy-path', 'scrcpy');
        if (!scrcpy) {
            this._notify(_('scrcpy is not installed'),
                _('Install it with “sudo apt install scrcpy” (or your distro’s package manager), then try again.'));
            return;
        }

        const major = await this._scrcpyMajorVersion(scrcpy);
        const s = this._settings;
        const mode = s.get_string('connection-mode');
        const argv = [scrcpy, '--window-title=ScreenCast Linux'];

        if (mode === 'wifi') {
            const target = this._wifiTarget();
            if (!target) {
                this._notify(_('No Wi-Fi phone configured'),
                    _('Plug your phone in by USB and choose “Set Up Wi-Fi From USB…”, or enter its IP address in Settings.'));
                return;
            }
            argv.push(`--tcpip=${target}`);
        } else {
            argv.push('--select-usb');
        }

        if (s.get_boolean('turn-screen-off'))
            argv.push('--turn-screen-off');
        if (s.get_boolean('stay-awake'))
            argv.push('--stay-awake');
        if (s.get_boolean('fullscreen'))
            argv.push('--fullscreen');
        if (!s.get_boolean('audio') && major >= 2)
            argv.push('--no-audio');
        if (s.get_int('max-size') > 0)
            argv.push(`--max-size=${s.get_int('max-size')}`);
        argv.push('-b', `${s.get_int('bit-rate')}M`);

        if (s.get_boolean('record')) {
            const dir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS) ?? GLib.get_home_dir();
            GLib.mkdir_with_parents(dir, 0o755);
            const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d_%H-%M-%S');
            argv.push(`--record=${GLib.build_filenamev([dir, `screencast-${stamp}.mp4`])}`);
        }

        const extra = s.get_string('extra-args').trim();
        if (extra) {
            const [ok, parsed] = GLib.shell_parse_argv(extra);
            if (ok)
                argv.push(...parsed);
        }

        // scrcpy finds adb via $ADB, so pass a custom adb path through.
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        });
        const adb = this._findProgram('adb-path', 'adb');
        if (adb)
            launcher.setenv('ADB', adb, true);

        this._log = [];
        const proc = launcher.spawnv(argv);
        this._proc = proc;
        this._readOutput(proc);
        this._sync();

        proc.wait_async(null, (p, res) => {
            try {
                p.wait_finish(res);
            } catch (e) {
                // ignore
            }
            if (this._proc !== p)
                return;
            this._proc = null;
            const stoppedByUser = this._stoppedProc === p;
            this._stoppedProc = null;
            if (!stoppedByUser && p.get_if_exited() && p.get_exit_status() !== 0)
                this._notify(_('Screen cast stopped'), this._errorSummary());
            this._sync();
        });
    }

    _readOutput(proc) {
        const stream = new Gio.DataInputStream({
            base_stream: proc.get_stdout_pipe(),
            close_base_stream: true,
        });
        const readLine = () => {
            stream.read_line_async(GLib.PRIORITY_LOW, null, (s, res) => {
                let line;
                try {
                    [line] = s.read_line_finish_utf8(res);
                } catch (e) {
                    return;
                }
                if (line === null)
                    return;
                this._log.push(line);
                if (this._log.length > MAX_LOG_LINES)
                    this._log.shift();
                readLine();
            });
        };
        readLine();
    }

    _errorSummary() {
        const errors = this._log.filter(l => /ERROR|error:|not found|unauthorized|failed/i.test(l));
        const text = (errors.length ? errors : this._log).slice(-4).join('\n');
        if (/unauthorized/i.test(text))
            return _('The phone has not authorised this computer. Unlock it and accept the “Allow USB debugging?” prompt.');
        if (/Could not find any ADB device|no devices|device not found/i.test(text))
            return _('No phone found. Check the cable/Wi-Fi and make sure USB debugging is enabled in Developer options.');
        return text || _('scrcpy exited unexpectedly.');
    }

    _stop() {
        if (!this._proc)
            return;
        this._stoppedProc = this._proc;
        this._proc.send_signal(15); // SIGTERM — lets scrcpy finalise recordings
    }

    async _setupWireless() {
        if (this._busy)
            return;
        const adb = this._findProgram('adb-path', 'adb');
        if (!adb) {
            this._notify(_('adb is not installed'),
                _('Install it with “sudo apt install adb” (it usually comes with scrcpy).'));
            return;
        }

        this._busy = true;
        this._sync();
        try {
            // Find the phone's Wi-Fi address while it is still on USB.
            let res = await runCommand([adb, '-d', 'shell', 'ip', 'route'], this._cancellable);
            if (!res.ok)
                throw new Error(res.out || _('No USB phone found.'));
            let ip = res.out.split('\n').filter(l => /wlan|wifi/i.test(l))
                .map(l => l.match(IPV4_SRC_RE)?.[1]).find(Boolean) ?? res.out.match(IPV4_SRC_RE)?.[1];
            if (!ip) {
                res = await runCommand([adb, '-d', 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], this._cancellable);
                ip = res.out.match(IPV4_INET_RE)?.[1];
            }
            if (!ip)
                throw new Error(_('Could not find the phone’s Wi-Fi address. Is the phone connected to Wi-Fi?'));

            const port = this._settings.get_int('wifi-port');
            res = await runCommand([adb, '-d', 'tcpip', `${port}`], this._cancellable);
            if (!res.ok)
                throw new Error(res.out);

            await wait(2000);
            res = await runCommand([adb, 'connect', `${ip}:${port}`], this._cancellable);
            if (!res.ok || /fail|unable|refused/i.test(res.out))
                throw new Error(res.out);

            this._settings.set_string('wifi-address', ip);
            this._settings.set_string('connection-mode', 'wifi');
            this._notify(_('Wi-Fi ready'),
                _('Connected to %s:%d. You can unplug the USB cable now.').format(ip, port));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                this._notify(_('Wi-Fi setup failed'), e.message);
        } finally {
            this._busy = false;
            if (!this._cancellable.is_cancelled())
                this._sync();
        }
    }

    _notify(title, body) {
        Main.notify(title, body);
    }

    destroy() {
        this._cancellable.cancel();
        this._stop();
        this._proc = null;
        super.destroy();
    }
});

const ScreenCastIndicator = GObject.registerClass(
class ScreenCastIndicator extends SystemIndicator {
    constructor(extension) {
        super();
        const gicon = Gio.icon_new_for_string(
            GLib.build_filenamev([extension.path, 'icons', 'screencast-symbolic.svg']));

        this._indicator = this._addIndicator();
        this._indicator.gicon = gicon;

        const toggle = new ScreenCastToggle(extension, gicon);
        toggle.connect('notify::checked', () => this._sync(toggle));
        this.quickSettingsItems.push(toggle);
        this._sync(toggle);
    }

    _sync(toggle) {
        this._indicator.visible = toggle.checked;
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class ScreenCastExtension extends Extension {
    enable() {
        this._indicator = new ScreenCastIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
