# Official Expo references

| Component | Source and implementation note |
| --- | --- |
| QR camera | [Expo Camera, SDK 57](https://docs.expo.dev/versions/latest/sdk/camera/) — `CameraView` works in Expo Go; use `barcodeScannerSettings` and `onBarcodeScanned`. |
| Encrypted credentials | [Expo SecureStore, SDK 57](https://docs.expo.dev/versions/latest/sdk/securestore/) — included in Expo Go; Android values use Keystore-backed encryption. |
| File picker | [Expo DocumentPicker, SDK 57](https://docs.expo.dev/versions/latest/sdk/document-picker/) — included in Expo Go; `copyToCacheDirectory: true` enables immediate file access. |
| Camera photo | [Expo ImagePicker, SDK 57](https://docs.expo.dev/versions/latest/sdk/imagepicker/) — included in Expo Go; `launchCameraAsync` returns a local image URI. |
| Authenticated file fetch | [Expo FileSystem, SDK 57](https://docs.expo.dev/versions/latest/sdk/filesystem/) — `downloadAsync` with request headers is imported from `expo-file-system/legacy`. |
| File viewer chooser | [Expo Sharing, SDK 57](https://docs.expo.dev/versions/latest/sdk/sharing/) — included in Expo Go; `shareAsync` opens compatible apps for a cached local file. |
