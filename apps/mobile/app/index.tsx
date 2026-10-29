import { ScrollView, StyleSheet, Text, View } from 'react-native';

const LAYERS: ReadonlyArray<readonly [string, string]> = [
  ['Brain runtime', 'Local inference, verified model cache.'],
  ['Connector registry', 'Capability-scoped access to the world.'],
  ['Tool sandbox', 'Every side effect isolated and audited.'],
  ['Monetization', 'Meters and entitlements, off the hot path.'],
];

export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>PRE-ALPHA</Text>
      <Text style={styles.title}>Ultran</Text>
      <Text style={styles.lede}>
        A local-first AI agent platform. The brain runs on your device.
      </Text>

      <View style={styles.grid}>
        {LAYERS.map(([title, body]) => (
          <View key={title} style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 48,
    backgroundColor: '#0b0d10',
    minHeight: '100%',
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.8,
    color: '#8b98a5',
  },
  title: {
    fontSize: 40,
    fontWeight: '700',
    color: '#e6edf3',
    marginTop: 8,
  },
  lede: {
    fontSize: 15,
    lineHeight: 22,
    color: '#8b98a5',
    marginTop: 10,
  },
  grid: {
    marginTop: 28,
    gap: 12,
  },
  card: {
    backgroundColor: '#14181d',
    borderWidth: 1,
    borderColor: '#232a32',
    borderRadius: 10,
    padding: 16,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e6edf3',
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#8b98a5',
  },
});
