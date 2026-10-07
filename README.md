# ScreenCast Linux

A GNOME Shell extension that adds a **Screen Cast** toggle to Quick Settings for mirroring and controlling your Android phone on the desktop with [scrcpy](https://github.com/Genymobile/scrcpy). It works over a **USB cable** or **Wi-Fi** (wireless ADB).

- One click starts mirroring and a second click stops it. While a cast is running, an icon shows in the top bar.
- You can pick **USB** or **Wi-Fi** from the toggle's menu.
- **Set Up Wi-Fi From USB…** finds your phone's IP address, switches ADB to TCP/IP and connects to it. After that you can unplug the cable.
- Quick switches cover turning the phone screen off, keeping the phone awake, forwarding audio, fullscreen, and recording to `~/Videos`.
- The preferences window has settings for resolution, bit rate, custom `scrcpy`/`adb` paths and extra scrcpy arguments.
- When something goes wrong you get a plain-language notification, for example when the phone is unauthorised, no device is found, or scrcpy is missing.

You don't need root, and you don't install anything on the phone.

## Requirements

- GNOME Shell 46–50
- `scrcpy` and `adb`

```bash
sudo apt install scrcpy adb        # Debian / Ubuntu
sudo dnf install scrcpy            # Fedora (RPM Fusion / COPR)
sudo pacman -S scrcpy android-tools # Arch
```

- **USB debugging** must be on: go to *Settings → About phone → tap "Build number" 7×*, then *Developer options → USB debugging*.

## Install

```bash
git clone https://github.com/adgsenpai/ScreenCastLinux.git
cd ScreenCastLinux
./install.sh
```

Log out and back in (Wayland), then run:

```bash
gnome-extensions enable screencast-linux@adgsenpai.github.com
```

## Usage

1. Plug the phone in by USB and accept the **Allow USB debugging?** prompt.
2. Open Quick Settings and click **Screen Cast**. The phone screen appears in a window that you control with your mouse and keyboard.
3. To use Wi-Fi, open the toggle's menu (the arrow) and choose **Set Up Wi-Fi From USB…**, then unplug the cable. Leave the mode set to **Wi-Fi** and click the toggle.

On Android 11+ you can also use *Developer options → Wireless debugging*. Pair once with `adb pair IP:PORT`, then enter `IP:PORT` in the extension's **Phone IP Address** setting.

## Troubleshooting

| Problem | Fix |
|---|---|
| "No phone found" | Check the cable or Wi-Fi, check that USB debugging is on, and run `adb devices` |
| "unauthorized" | Unlock the phone and accept the debugging prompt |
| Wi-Fi stops working after a phone reboot | Plug in by USB and run **Set Up Wi-Fi From USB…** again |
| Audio missing | Audio needs scrcpy ≥ 2.0 and Android ≥ 11 |

To see logs, run `journalctl -f -o cat /usr/bin/gnome-shell`.

## License

MIT
