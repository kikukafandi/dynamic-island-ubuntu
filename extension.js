import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {MprisPlayer} from 'resource:///org/gnome/shell/ui/mpris.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const EXPANDED_SIZE = [400, 110]; // ponytail: fixed sizes, make them settings if anyone asks
const NOTIFICATION_SIZE = [400, 76];
const OSD_SIZE = [300, 36];
const MAX_COMPACT_WIDTH = 360;
const DURATION = 450;
const FADE = 180;
const COLLAPSE_DELAY = 200; // ms of grace so brushing the edge doesn't flicker
const NOTIFICATION_TIMEOUT = 4000;
const OSD_TIMEOUT = 1500;
const BATTERY_TIMEOUT = 3000;
const LOW_BATTERY = [20, 10]; // warn once when dropping past each of these percentages
const UPOWER_BATTERY = 2;
const PLUGGED_STATES = [1, 4, 5]; // charging, fully charged, pending charge

function label(styleClass) {
    const l = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

function button(iconName, callback) {
    const b = new St.Button({
        style_class: 'island-button',
        child: new St.Icon({icon_name: iconName, icon_size: 20}),
    });
    b.connect('clicked', callback);
    return b;
}

function view(params = {}) {
    return new St.BoxLayout({x_expand: true, y_expand: true, visible: false, ...params});
}

const Island = GObject.registerClass(
class Island extends St.Widget {
    _init() {
        super._init({
            style_class: 'dynamic-island',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._player = null;
        this._hovered = false;
        this._activity = null; // {view, size, onClick} shown temporarily over everything else

        // Compact: clock, or app/cover icon + track title
        this._compact = view({
            style_class: 'island-compact',
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: true,
        });
        this._compactIcon = new St.Icon({icon_size: 16, visible: false});
        this._compactLabel = label('');
        // Clock stays visible next to the track title while media plays (panel clock is hidden under the island)
        this._compactClock = new St.Label({style_class: 'island-compact-clock', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._compactClock.clutter_text.ellipsize = Pango.EllipsizeMode.NONE; // the title shrinks, never the clock
        this._compact.add_child(this._compactIcon);
        this._compact.add_child(this._compactLabel);
        this._compact.add_child(this._compactClock);
        this._current = this._compact;

        // Expanded on hover: cover art, title/artist, controls
        this._full = view({style_class: 'island-expanded'});
        this._art = new St.Icon({style_class: 'island-art', icon_size: 76});
        const info = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = label('island-title');
        this._artist = label('island-artist');
        const controls = this._controls = new St.BoxLayout({style_class: 'island-controls', x_align: Clutter.ActorAlign.CENTER});
        this._prev = button('media-skip-backward-symbolic', () => this._player?.previous());
        this._play = button('media-playback-start-symbolic', () => this._player?.playPause());
        this._next = button('media-skip-forward-symbolic', () => this._player?.next());
        [this._prev, this._play, this._next].forEach(b => controls.add_child(b));
        // Swallow clicks on disabled buttons so they don't fall through and raise the player
        controls.reactive = true;
        controls.connect('button-release-event', () => Clutter.EVENT_STOP);
        [this._title, this._artist, controls].forEach(a => info.add_child(a));
        this._full.add_child(this._art);
        this._full.add_child(info);

        // Notification: app icon, title, body
        this._notif = view({style_class: 'island-expanded'});
        this._notifIcon = new St.Icon({icon_size: 44, y_align: Clutter.ActorAlign.CENTER});
        const notifText = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._notifTitle = label('island-title');
        this._notifBody = label('island-artist');
        notifText.add_child(this._notifTitle);
        notifText.add_child(this._notifBody);
        this._notif.add_child(this._notifIcon);
        this._notif.add_child(notifText);

        // OSD (volume, brightness, ...): icon, level bar, percentage
        this._osd = view({style_class: 'island-osd'});
        this._osdIcon = new St.Icon({icon_size: 18, y_align: Clutter.ActorAlign.CENTER});
        const track = new St.Widget({
            style_class: 'island-level',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this._osdFill = new St.Widget({
            style_class: 'island-level-fill',
            x_expand: true,
            y_expand: true,
            pivot_point: new Graphene.Point({x: 0, y: 0.5}),
            scale_x: 0,
        });
        track.add_child(this._osdFill);
        this._osdLabel = label('island-osd-label');
        this._osd.add_child(this._osdIcon);
        this._osd.add_child(track);
        this._osd.add_child(this._osdLabel);

        [this._compact, this._full, this._notif, this._osd].forEach(v => this.add_child(v));

        // Mirror the panel clock instead of running our own
        this._clock = Main.panel.statusArea.dateMenu._clockDisplay;
        this._clock.connectObject('notify::text', () => {
            this._compactClock.text = this._clock.text;
            if (!this._player)
                this._compactLabel.text = this._artist.text = this._clock.text;
            this._update();
        }, this);

        this.connect('notify::hover', () => {
            this._clearSource('_collapseId');
            if (this.hover) {
                this._hovered = true;
                this._update();
                return;
            }
            this._collapseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COLLAPSE_DELAY, () => {
                this._collapseId = null;
                this._hovered = false;
                this._update();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.connect('destroy', () => {
            this._clearSource('_collapseId');
            this._clearSource('_activityId');
        });
        this.connect('notify::width', () => this._reposition());
        this.connect('button-release-event', () => {
            if (this._activity?.onClick)
                this._activity.onClick();
            else if (this._player)
                this._player.raise();
            else
                Main.panel.statusArea.dateMenu.menu.toggle();
            return Clutter.EVENT_STOP;
        });
    }

    setPlayer(player) {
        this._player = player;
        if (!player) {
            this._compactIcon.hide();
            this._compactClock.hide();
            this._compactLabel.text = this._clock.text;
            this._art.gicon = new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
            this._title.text = 'Tidak ada media';
            this._artist.text = this._clock.text;
            this._controls.hide();
            this._update();
            return;
        }

        const gicon = player.trackCoverUrl
            ? new Gio.FileIcon({file: Gio.File.new_for_uri(player.trackCoverUrl)})
            : player.app?.get_icon() ?? new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
        this._compactIcon.gicon = gicon;
        this._compactIcon.show();
        this._compactClock.text = this._clock.text;
        this._compactClock.show();
        this._controls.show();
        this._compactLabel.text = player.trackTitle;
        this._art.gicon = gicon;
        this._title.text = player.trackTitle;
        this._artist.text = player.trackArtists.join(', ');
        this._play.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        // Dimmed via :insensitive when the player can't skip (e.g. a single YouTube video)
        this._prev.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        this._update();
    }

    showNotification(notification) {
        this._notifIcon.gicon = notification.gicon ?? notification.source?.icon ??
            new Gio.ThemedIcon({name: 'dialog-information-symbolic'});
        this._notifTitle.text = notification.title ?? '';
        this._notifBody.text = (notification.body ?? '').replace(/\s+/g, ' ');
        this._showActivity(this._notif, NOTIFICATION_SIZE, NOTIFICATION_TIMEOUT, () => {
            notification.activate();
            this._endActivity();
        });
    }

    showOsd(icon, level, maxLevel, {text = null, tone = null, timeout = OSD_TIMEOUT} = {}) {
        const fraction = Math.clamp(level / maxLevel, 0, 1);
        this._osdIcon.gicon = icon;
        this._osdLabel.text = text ?? `${Math.round(level * 100)}%`;
        ['charging', 'low'].forEach(t => this._osdFill.remove_style_class_name(t));
        if (tone)
            this._osdFill.add_style_class_name(tone);
        this._osdFill.ease({scale_x: fraction, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._showActivity(this._osd, OSD_SIZE, timeout, null);
    }

    _showActivity(activityView, size, timeout, onClick) {
        this._clearSource('_activityId');
        this._activity = {view: activityView, size, onClick};
        this._activityId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
            this._activityId = null;
            this._endActivity();
            return GLib.SOURCE_REMOVE;
        });
        this._update();
    }

    _endActivity() {
        this._clearSource('_activityId');
        this._activity = null;
        this._update();
    }

    _clearSource(key) {
        if (this[key])
            GLib.Source.remove(this[key]);
        this[key] = null;
    }

    _compactSize() {
        const [, natW] = this._compact.get_preferred_width(-1);
        const node = this.get_theme_node();
        const chrome = node.get_horizontal_padding() +
            node.get_border_width(St.Side.LEFT) + node.get_border_width(St.Side.RIGHT);
        return [Math.min(natW + chrome, MAX_COMPACT_WIDTH), Main.panel.height - 6];
    }

    // Single place that decides what the island shows: activity > hover > compact
    _update() {
        let target = [this._compact, this._compactSize()];
        if (this._activity)
            target = [this._activity.view, this._activity.size];
        else if (this._hovered)
            target = [this._full, EXPANDED_SIZE];
        const [next, size] = target;

        if (next !== this._current) {
            this._crossfade(this._current, next);
            this._current = next;
        }
        if (next === this._compact || next === this._osd) // OSD is a slim pill, keep compact padding
            this.remove_style_class_name('expanded');
        else
            this.add_style_class_name('expanded');
        this._easeTo(size);
    }

    _crossfade(from, to) {
        from.remove_all_transitions();
        to.remove_all_transitions();
        from.ease({opacity: 0, duration: FADE, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => from.hide()});
        to.show();
        to.opacity = 0;
        to.ease({opacity: 255, delay: FADE / 2, duration: DURATION - FADE / 2, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _easeTo([width, height]) {
        this.ease({width, height, duration: DURATION, mode: Clutter.AnimationMode.EASE_OUT_QUINT});
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor)
            this.set_position(Math.round(monitor.x + (monitor.width - this.width) / 2), monitor.y + 3);
    }
});

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._island = new Island();
        Main.layoutManager.addTopChrome(this._island, {trackFullscreen: true});
        this._island.setPlayer(null);
        Main.layoutManager.connectObject('monitors-changed', () => this._island._reposition(), this);

        // The island sits on top of the clock; keep the clock allocated so the calendar menu still anchors to it
        Main.panel.statusArea.dateMenu.opacity = 0;

        this._enableMedia();
        this._enableNotifications();
        this._enableOsd();
        this._enableBattery();
    }

    disable() {
        this._batteryCancellable.cancel();
        this._battery?.disconnectObject(this);
        this._battery = null;

        Main.osdWindowManager.show = this._origOsdShow;

        Main.messageTray.disconnectObject(this);
        Main.messageTray.getSources().forEach(s => s.disconnectObject(this));
        delete Main.messageTray.bannerBlocked; // drop our override, back to the prototype setter
        Main.messageTray._notificationQueue = []; // ponytail: private; avoids a burst of stale banners after unlock
        Main.messageTray.bannerBlocked = false;

        Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
        for (const player of this._players.values()) {
            player.disconnectAll();
            player._close(); // ponytail: private, but it's the only way to drop the DBus proxies
        }
        this._players = null;

        Main.layoutManager.disconnectObject(this);
        Main.panel.statusArea.dateMenu.opacity = 255;
        this._island.destroy();
        this._island = null;
    }

    _enableOsd() {
        // Leveled OSDs (volume, brightness) go to the island; text-only ones (caps lock, ...) keep the stock popup
        this._origOsdShow = Main.osdWindowManager.show;
        Main.osdWindowManager.show = (monitorIndex, icon, label, level, maxLevel) => {
            if (typeof level !== 'number')
                return this._origOsdShow.call(Main.osdWindowManager, monitorIndex, icon, label, level, maxLevel);
            this._island.showOsd(icon, level, maxLevel ?? 1);
        };
    }

    _enableBattery() {
        this._batteryCancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice',
            'org.freedesktop.UPower.Device', this._batteryCancellable, (o, res) => {
                try {
                    this._battery = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e, 'dynamic-island: UPower unavailable');
                    return;
                }
                this._battery.connectObject('g-properties-changed', () => this._onBattery(), this);
                this._onBattery();
            });
    }

    // Pops the island on plug/unplug and when the battery drops past a LOW_BATTERY threshold
    _onBattery() {
        const get = name => this._battery.get_cached_property(name)?.unpack();
        if (!get('IsPresent') || get('Type') !== UPOWER_BATTERY)
            return;
        const pct = get('Percentage');
        const plugged = PLUGGED_STATES.includes(get('State'));
        const first = this._plugged === undefined;
        const pluggedChanged = plugged !== this._plugged;
        const crossedLow = !plugged && LOW_BATTERY.some(t => this._lastPct > t && pct <= t);
        this._plugged = plugged;
        this._lastPct = pct;
        if (first || !(pluggedChanged || crossedLow))
            return;

        const tone = plugged ? 'charging' : pct <= LOW_BATTERY[0] ? 'low' : null;
        const text = plugged ? `Mengisi · ${Math.round(pct)}%` : `${Math.round(pct)}%`;
        this._island.showOsd(new Gio.ThemedIcon({name: get('IconName')}), pct, 100,
            {text, tone, timeout: BATTERY_TIMEOUT});
    }

    _enableNotifications() {
        // Stock banners are replaced by the island. The panel flips bannerBlocked when menus open/close,
        // so pin it to true with an instance property instead of setting it once.
        Main.messageTray.bannerBlocked = true;
        Object.defineProperty(Main.messageTray, 'bannerBlocked', {configurable: true, get: () => true, set: () => {}});

        const watch = source => source.connectObject(
            'notification-request-banner', (s, n) => this._onBanner(n), this);
        Main.messageTray.getSources().forEach(watch);
        Main.messageTray.connectObject('source-added', (tray, source) => watch(source), this);
    }

    _onBanner(notification) {
        // Same filter the stock message tray uses before showing a banner
        if (notification.acknowledged || notification.urgency === MessageTray.Urgency.LOW)
            return;
        if (!notification.source.policy.showBanners && notification.urgency !== MessageTray.Urgency.CRITICAL)
            return;
        this._island.showNotification(notification);
    }

    _enableMedia() {
        this._players = new Map();
        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
            });
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
                } catch (e) {
                    logError(e, 'dynamic-island: ListNames failed');
                }
            });
    }

    _addPlayer(name) {
        if (!this._players || this._players.has(name))
            return;
        const player = new MprisPlayer(name);
        player.connect('changed', () => this._sync());
        player.connect('closed', () => {
            this._players?.delete(name);
            this._sync();
        });
        this._players.set(name, player);
    }

    _sync() {
        if (!this._players)
            return;
        const players = [...this._players.values()];
        const active = players.find(p => p.status === 'Playing') ??
            players.find(p => p.status === 'Paused') ?? null;
        this._island.setPlayer(active);
    }
}
