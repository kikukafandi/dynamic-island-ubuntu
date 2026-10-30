# Dynamic Island for Ubuntu (GNOME Shell)

An iPhone-style dynamic island in the GNOME top bar.

- **Invisible when idle**: blends into the top bar, appears only for activity (hover shows the time, click opens the calendar)
- **Now playing** media (MPRIS): cover + animated waveform tinted with the album-art colour; hover to expand with title and ⏮ ⏯ ⏭; fades away after 30 s paused
- **Coloured glow** per activity (notifications, volume, battery, privacy, Do Not Disturb)
- **Fullscreen aware**: stays hidden over presentations and videos, only pops up for activities
- **Notifications** pop into the island (replaces stock banners)
- **Volume / brightness** level shown in the island (replaces stock OSD)
- **Battery**: pops up when the charger is plugged/unplugged and when it drops to 20% / 10%
- **Privacy dots**: green camera, orange microphone, red screen recording
- **Do Not Disturb** and **Caps Lock** changes pop a short pill
- **MacBook-style menu bar**: bold focused-app name on the left, Activities hidden, clock on the far right

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

Note: the extension makes the top bar transparent (see `stylesheet.css`); pair it with blur-my-shell's panel blur for the frosted macOS look.

## License

MIT, see [LICENSE](LICENSE).

## Development

`node accent.test.mjs` checks the album-art colour extraction.
