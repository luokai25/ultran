import type { CloudProviderId } from "./cloud-llm";
export declare function providerFromKeyFilename(filename: string): CloudProviderId | null;
export declare function parseProviderKeyFile(contents: string): string[];
