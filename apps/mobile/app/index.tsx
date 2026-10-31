import { BUILTIN_CONNECTORS } from '@ultran/connectors';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

const LAYERS: ReadonlyArray<readonly [string, string]> = [
  ['Brain runtime', 'Local inference with Ollama pairing.'],
  ['Connector registry', '10 provider manifests and 21 declared tools.'],
  ['Tool sandbox', 'Capability-scoped access with explicit permissions.'],
  ['Local-first', 'No cloud account required for the local app shell.'],
];

export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>LOCAL-FIRST AI WORKSPACE</Text>
      <Text style={styles.title}>Ultran</Text>
      <Text style={styles.lede}>
        Your agents, models, tools, and connections in one place.
      </Text>

      <View style={styles.grid}>
        {LAYERS.map(([title, body]) => (
          <View key={title} style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Connector catalogue</Text>
      <Text style={styles.sectionBody}>
        Available connector definitions. A listed manifest describes permissions and tools;
        an execution adapter and account authorization are still required to use a provider.
      </Text>
      <View style={styles.grid}>
        {BUILTIN_CONNECTORS.map((connector) => (
          <View key={connector.id} style={styles.connectorCard}>
            <View style={styles.connectorHeader}>
              <Text style={styles.cardTitle}>{connector.displayName}</Text>
              <Text style={styles.tag}>{connector.auth.kind.toUpperCase()}</Text>
            </View>
            <Text style={styles.cardBody}>{connector.description}</Text>
            <Text style={styles.meta}>
              {connector.tools.length} tools · {connector.capabilities.length} permissions
            </Text>
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
    paddingBottom: 48,
    backgroundColor: '#0b0d10',
    minHeight: '100%',
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.8, color: '#d6ad62' },
  title: { fontSize: 40, fontWeight: '700', color: '#f3f4f6', marginTop: 8 },
  lede: { fontSize: 15, lineHeight: 22, color: '#9aa4b2', marginTop: 10 },
  grid: { marginTop: 18, gap: 10 },
  card: {
    backgroundColor: '#14181d', borderWidth: 1, borderColor: '#292f38',
    borderRadius: 12, padding: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#f3f4f6', marginBottom: 5 },
  cardBody: { fontSize: 13, lineHeight: 19, color: '#9aa4b2' },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#f3f4f6', marginTop: 32 },
  sectionBody: { fontSize: 13, lineHeight: 19, color: '#9aa4b2', marginTop: 8 },
  connectorCard: {
    backgroundColor: '#11151a', borderWidth: 1, borderColor: '#292f38',
    borderRadius: 12, padding: 14,
  },
  connectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { color: '#d6ad62', fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  meta: { color: '#d6ad62', fontSize: 11, marginTop: 10 },
});
