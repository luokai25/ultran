# @ultran/mobile

The Ultran mobile client - a React Native (Expo) console for a local brain.

## Responsibilities

| Area | Detail |
| --- | --- |
| **Local pairing** | Discovers and pairs with `agent-core` running on the same device or LAN. |
| **Run feed** | Live projection of the run event log, streamed over IPC. |
| **Grant prompts** | The primary approval surface for capability requests - this is where users say yes or no. |
| **Offline mode** | Fully functional without the cloud; syncs the journal when connectivity returns. |

## Design notes

- The mobile app is the **canonical** approval surface. Because a capability
  grant is a security decision, it should be made on the device that will
  execute the tool, with biometric confirmation where available.
- No model weights are bundled. The app talks to the local runtime; it does
  not link an inference engine into the JS bundle.

## Getting started

```bash
pnpm --filter @ultran/mobile dev
pnpm --filter @ultran/mobile ios
pnpm --filter @ultran/mobile android
```

## Structure

```
app/            # expo-router file-based routes
src/
├── components/ # Mobile-specific composed components
└── lib/        # agent-core client, secure storage, sync journal
```
