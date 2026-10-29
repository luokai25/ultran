import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0b0d10' },
          headerTintColor: '#e6edf3',
          contentStyle: { backgroundColor: '#0b0d10' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Ultran' }} />
      </Stack>
    </>
  );
}
