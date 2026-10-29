# Dynamic Island for Ubuntu (GNOME Shell)

An iPhone-style dynamic island in the GNOME top bar.

- **Clock** when idle (click opens the calendar)
- **Now playing** media (MPRIS): cover + title; hover to expand with ⏮ ⏯ ⏭
- **Notifications** pop into the island (replaces stock banners)
- **Volume / brightness** level shown in the island (replaces stock OSD)
- **Battery**: pops up when the charger is plugged/unplugged and when it drops to 20% / 10%

Supports GNOME Shell 46 (Ubuntu 24.04).

## Install

```sh
git clone https://github.com/kikukafandi/dynamic-island-ubuntu.git \
  ~/.local/share/gnome-shell/extensions/dynamic-island@kikuk
```

Restart GNOME Shell (X11: `Alt+F2`, `r`, Enter; Wayland: log out and back in), then:

```sh
gnome-extensions enable dynamic-island@kikuk
```

Note: the extension also makes the top bar transparent (see `stylesheet.css`).
