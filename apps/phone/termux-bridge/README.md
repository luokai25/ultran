# Legacy Termux bridge (not required by Ultran)

This folder contains an older optional localhost bridge for users who already run the separate Termux app. It is **not** part of Ultran's intended architecture and is no longer exposed in Ultran Settings.

Ultran's supported direction is to install its own Termux-derived runtime into Ultran's private app storage and let the local agent execute approved jobs through Android WorkManager. No separate Termux APK, bridge process, pairing token, or terminal screen should be required.

Keep this bridge only for backward compatibility with older installations. Do not use it as the foundation for new Ultran features, and do not claim it provides complete Termux integration or always-on execution.
