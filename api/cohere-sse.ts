export type CohereSseParser = { push(chunk: string, final?: boolean): string[] };

export function createCohereSseParser(): CohereSseParser {
  let buffer = "";

  const parseLine = (rawLine: string): string[] => {
    const line = rawLine.replace(/\\r$/, "").trim();
    if (!line.startsWith("data:")) return [];
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return [];
    try {
      const event = JSON.parse(raw) as {
        delta?: {
          message?: { content?: { text?: string } };
          text?: string;
        };
      };
      const text = event.delta?.message?.content?.text ?? event.delta?.text ?? "";
      return typeof text === "string" && text.length ? [text] : [];
    } catch {
      return [];
    }
  };

  return {
    push(chunk: string, final = false): string[] {
      buffer += chunk;
      const tokens: string[] = [];
      let newline = buffer.indexOf("\\n");
      while (newline >= 0) {
        tokens.push(...parseLine(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\\n");
      }
      if (final && buffer.length) {
        tokens.push(...parseLine(buffer));
        buffer = "";
      }
      return tokens;
    },
  };
}
